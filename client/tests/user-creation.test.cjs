const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), rx = require('rxjs');

async function setup() {
  await import('@angular/compiler');
  const forms = await import('@angular/forms');
  const requests = [], groups = [];
  const signal = initial => { let value = initial; const read = () => value; read.set = next => { value = next; }; return read; };
  const deps = { organization: { isSuperuser: () => false }, fb: new forms.FormBuilder() };
  const mocks = {
    '@angular/core': { Component: () => value => value, inject: key => deps[key], signal, computed: fn => fn },
    '@angular/common': {}, '@angular/forms': { ...forms, FormBuilder: 'fb' }, '@angular/router': {},
    '../../core/organization-context.service': { OrganizationContextService: 'organization' },
    '../../shared/countries': { getBrowserCountry: () => 'Philippines' },
    '../../core/table-preferences': {}, rxjs: rx,
  };
  const filename = path.join(__dirname, '../src/app/pages/users-page/users-page.component.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] || {} });
  const api = { create(url, payload) { const stream = new rx.Subject(); requests.push({ url, payload, stream }); return stream; } };
  const auth = { currentUser: () => ({ organizationId: 'org' }) };
  const page = new module.exports.UsersPageComponent(api, auth);
  page.createUserForm.patchValue({ firstName: 'New', lastName: 'User', email: 'new@example.test', password: 'synthetic-password' });
  page.createSelectedRoleIds = ['role']; page.isCreateModalOpen.set(true);
  let reloads = 0; page.load = () => { reloads++; };
  return { page, requests, reloads: () => reloads };
}

test('pending user creation ignores repeated button and keyboard submissions', async () => {
  const f = await setup(); assert.equal(f.page.createUserForm.valid, true);
  f.page.createUser(); f.page.createUser(); f.page.createUser();
  assert.equal(f.requests.length, 1); assert.equal(f.page.submitting(), true);
});

test('a saved user closes creation even if invitation delivery failed, avoiding a misleading retry', async () => {
  const f = await setup(); f.page.createUser();
  f.requests[0].stream.next({ message: 'User created successfully.', data: { id: 'new', inviteEmail: { sent: false, message: 'User was created, but invite email could not be sent.' } } });
  assert.equal(f.page.submitting(), false); assert.equal(f.page.isCreateModalOpen(), false);
  assert.match(f.page.message(), /User was created/); assert.equal(f.reloads(), 1);
});

test('API validation/conflict failures preserve the form, show the message and unlock retry', async () => {
  for (const status of [400, 409, 500]) {
    const f = await setup(); const before = f.page.createUserForm.getRawValue(); f.page.createUser();
    f.requests[0].stream.error({ status, error: { message: 'Specific API error' } });
    assert.equal(f.page.submitting(), false); assert.equal(f.page.isCreateModalOpen(), true); assert.equal(f.page.createModalError(), 'Specific API error');
    assert.deepEqual(f.page.createUserForm.getRawValue(), before); f.page.createUser(); assert.equal(f.requests.length, 2);
  }
});

test('real Angular form validation matches database text field limits', async () => {
  const f = await setup();
  for (const [field, maximum] of Object.entries({ firstName: 100, lastName: 100, phone: 30, city: 100, state: 100, country: 100, postalCode: 20, addressLine1: 255, addressLine2: 255 })) {
    const control = f.page.createUserForm.get(field); control.setValue('x'.repeat(maximum)); assert.equal(control.hasError('maxlength'), false, field);
    control.setValue('x'.repeat(maximum + 1)); assert.equal(control.hasError('maxlength'), true, field);
  }
  f.page.createUser(); assert.equal(f.requests.length, 0);
});
