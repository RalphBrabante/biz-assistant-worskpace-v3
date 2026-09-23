const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadCountries(browser = {}) {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const filename = path.join(__dirname, '../src/app/shared', `${name}.ts`);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(code, {
      module, exports: module.exports, ...browser,
      require: (name) => name.startsWith('./') ? load(name.slice(2)) : {
        Component: () => (value) => value,
        Input: () => () => {},
        forwardRef: (value) => value,
      },
    });
    cache.set(name, module.exports);
    return module.exports;
  }
  return { ...load('countries'), Component: load('country-select.component').CountrySelectComponent };
}

const countries = loadCountries();
for (const [zone, languages, expected] of [
  ['Asia/Manila', ['en-US'], 'Philippines'],
  ['Asia/Singapore', ['en-PH'], 'Singapore'],
  ['America/New_York', ['en-PH'], 'United States'],
  ['Europe/London', ['en-US'], 'United Kingdom'],
  ['Asia/Calcutta', ['en-US'], 'India'],
  ['Australia/Sydney', ['en-US'], 'Australia'],
  ['UTC', ['en-PH'], 'Philippines'],
  ['UTC', ['en', 'en-GB'], 'United Kingdom'],
  ['unavailable', ['not_a_locale', 'ja-JP'], 'Japan'],
  ['', ['en'], 'Philippines'],
  ['', [], 'Philippines'],
]) {
  test(`country default: ${zone} / ${languages.join(',')} → ${expected}`, () => {
    assert.equal(countries.inferCountry(zone, languages), expected);
  });
}

test('reads the browser time zone before its language preference', () => {
  const browser = loadCountries({
    navigator: { languages: ['en-US'] },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'Asia/Manila' }) }), Locale: Intl.Locale },
  });
  assert.equal(browser.getBrowserCountry(), 'Philippines');
});

test('a restricted time zone falls back to the browser region', () => {
  const browser = loadCountries({
    navigator: { language: 'en-CA' },
    Intl: { DateTimeFormat: () => { throw new Error('restricted'); }, Locale: Intl.Locale },
  });
  assert.equal(browser.getBrowserCountry(), 'Canada');
});

test('missing browser APIs use the Philippines fallback', () => {
  const browser = loadCountries({ Intl: {} });
  assert.equal(browser.getBrowserCountry(), 'Philippines');
});

test('dropdown contains all ISO countries with consistent English stored values', () => {
  assert.equal(countries.COUNTRIES.length, 249);
  assert.equal(new Set(countries.COUNTRIES).size, 249);
  for (const name of ['Philippines', 'United States', 'Japan', 'Singapore']) assert.ok(countries.COUNTRIES.includes(name));
  assert.equal(countries.COUNTRIES.includes('European Union'), false);
});

test('editing preserves an existing country instead of replacing it with the browser default', () => {
  const control = new countries.Component();
  let changes = 0;
  control.registerOnChange(() => changes++);
  control.writeValue('United States');
  assert.equal(control.value, 'United States');
  assert.ok(control.options.includes('United States'));
  assert.equal(changes, 0);
});

test('legacy country names remain visible until the user chooses a replacement', () => {
  const control = new countries.Component();
  control.writeValue('U.S.A.');
  assert.equal(control.value, 'U.S.A.');
  assert.ok(control.options.includes('U.S.A.'));
  assert.ok(control.options.includes('Philippines'));
});

test('dropdown propagates user selection and touch and supports disabled controls', () => {
  const control = new countries.Component();
  let selected, touched = false;
  control.registerOnChange((value) => { selected = value; });
  control.registerOnTouched(() => { touched = true; });
  control.selectCountry('Philippines');
  control.onTouched();
  assert.equal(selected, 'Philippines');
  assert.equal(touched, true);
  control.setDisabledState(true);
  assert.equal(control.disabled, true);
  control.setDisabledState(false);
  assert.equal(control.disabled, false);
});

test('clearing an optional country is preserved rather than forcing a new default', () => {
  const control = new countries.Component();
  control.writeValue(null);
  assert.equal(control.value, '');
  let selected;
  control.registerOnChange((value) => { selected = value; });
  control.selectCountry('');
  assert.equal(selected, '');
});
