const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = path.join(__dirname, '../src/app');
function templates(dir = app, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) templates(full, found);
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}
function offenders(pattern) {
  return templates().filter(file => pattern.test(fs.readFileSync(file, 'utf8'))).map(file => path.relative(app, file));
}

test('templates do not use Bootstrap classes that Tailwind ignores', () => {
  // Matches whole class tokens, so ui-form-control is not mistaken for form-control.
  assert.deepEqual(offenders(/\[class\.pe-none\]|class="(?:[^"]*\s)?(?:pe-none|fade|d-flex|d-none|col-md-\d+|form-control|form-select|btn|text-bg-\w+)(?:\s[^"]*)?"/), []);
});

test('templates use utilities rather than static inline styles', () => {
  assert.deepEqual(offenders(/\sstyle="/), []);
});

test('templates use color tokens rather than hex values in class names', () => {
  assert.deepEqual(offenders(/(?:bg|text|border)-\[#[0-9a-fA-F]+\]/), []);
});

test('templates keep text at or above the smallest readable size', () => {
  assert.deepEqual(offenders(/text-\[(?:[0-9]|10)px\]/), []);
});

test('every semantic color token resolves to a defined theme variable in both themes', () => {
  const config = fs.readFileSync(path.join(__dirname, '../tailwind.config.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');
  const light = styles.match(/:root \{([\s\S]*?)\n  \}/)[1];
  const dark = styles.match(/\[data-theme='dark'\] \{([\s\S]*?)\n  \}/)[1];
  for (const [, name] of config.matchAll(/var\((--[\w-]+)\)/g)) {
    assert.ok(light.includes(`${name}:`), `${name} missing from the light theme`);
    assert.ok(dark.includes(`${name}:`), `${name} missing from the dark theme`);
  }
});

test('forms block input while submitting', () => {
  const customers = fs.readFileSync(path.join(app, 'pages/customers-page/customers-page.component.html'), 'utf8');
  assert.match(customers, /\[class\.pointer-events-none\]="submitting\(\)"/);
});
