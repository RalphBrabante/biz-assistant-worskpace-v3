const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), rx = require('rxjs');

async function setup({ administrator = false, superuser = false } = {}) {
  await import('@angular/compiler');
  const forms = await import('@angular/forms');
  const requests = [], groups = [];
  const signal = initial => { let value = initial; const read = () => value; read.set = next => { value = next; }; return read; };
  const deps = { organization: { isSuperuser: () => superuser, getActiveOrganizationId: () => 'org' }, fb: new forms.FormBuilder() };
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
  const api = { create(url, payload) { const stream = new rx.Subject(); requests.push({ url, payload, stream }); return stream; },
    list: url => rx.of({ data: url.includes('/roles') ? [{ id: 'role', code: 'accountant', name: 'Accountant' }, { id: 'global', code: 'superuser' }] : [{ id: 'org', name: 'Current Company' }, { id: 'other', name: 'Other Company' }] }),
  };
  const auth = { currentUser: () => ({ organizationId: 'org', organizationName: 'Current Company', roleCodes: superuser ? ['superuser'] : administrator ? ['administrator'] : [] }) };
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

const pause = () => new Promise(resolve => setTimeout(resolve, 20));
const existing = { id: 'shared', firstName: 'Existing', lastName: 'User', email: 'shared@example.test', canAssign: true, alreadyAssigned: false, inactiveMembership: false };
test('email suggestion allows assignment without new-account fields and submits only organization access', async () => {
  const f = await setup({ administrator: true }); f.page.openCreateModal();
  f.page.createUserForm.patchValue({ email: 'shared@example.test' }); f.page.checkExistingEmail(true); await pause();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, '/api/v1/users/lookup-email');
  f.requests[0].stream.next({ data: existing });
  assert.equal(f.page.createUserForm.invalid, true); assert.equal(f.page.existingUser().id, 'shared');
  f.page.existingRoleId = 'role'; f.page.createUser(); f.page.createUser();
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].url, '/api/v1/users/assign-existing');
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests[1].payload)), { userId:'shared', email:'shared@example.test', organizationId:'org', roleId:'role' });
  f.requests[1].stream.next({ message: 'Existing user assigned to organization.', data: {} });
  assert.equal(f.page.isCreateModalOpen(), false); assert.equal(f.reloads(), 1); assert.match(f.page.message(), /assigned/);
});
test('changing email or organization cancels stale suggestions; closing cancels pending checks', async () => {
  const f = await setup({ superuser: true }); f.page.openCreateModal();
  f.page.createUserForm.patchValue({ email:'shared@example.test' }); f.page.checkExistingEmail(true); await pause();
  const old = f.requests[0]; f.page.createUserForm.patchValue({ email:'new@example.test' });
  old.stream.next({ data: existing }); assert.equal(f.page.existingUser(), null); assert.equal(f.page.emailLookupLoading(), true);
  f.page.checkExistingEmail(true); await pause(); f.requests.at(-1).stream.next({ data:null });
  assert.equal(f.page.emailLookupLoading(),false);
  f.page.createUserForm.patchValue({ email:'shared@example.test' }); f.page.checkExistingEmail(true); await pause(); f.requests.at(-1).stream.next({ data:existing });
  assert.equal(f.page.existingUser().id,'shared'); f.page.existingRoleId='role';
  f.page.createUserForm.patchValue({ organizationId:'other' }); assert.equal(f.page.existingUser(),null); assert.equal(f.page.existingRoleId,'');
  f.page.checkExistingEmail(true); await pause(); assert.equal(f.requests.at(-1).payload.organizationId,'other');
  f.page.closeCreateModal(); f.requests.at(-1).stream.next({ data:existing }); assert.equal(f.page.existingUser(),null); assert.equal(f.page.emailLookupLoading(),false);
});
test('an existing active membership or inactive account blocks assignment and a failed lookup is retryable', async () => {
  const f = await setup({ administrator:true }); f.page.openCreateModal(); f.page.createUserForm.patchValue({email:'shared@example.test'});
  f.page.checkExistingEmail(true); await pause(); f.requests[0].stream.error({error:{message:'Check failed'}});
  assert.equal(f.page.emailLookupError(),'Check failed'); assert.equal(f.page.submitting(),false);
  f.page.checkExistingEmail(true); await pause(); f.requests[1].stream.next({ data:{...existing,alreadyAssigned:true,canAssign:false} });
  f.page.createUser(); assert.equal(f.requests.length,2);
  f.page.existingUser.set({...existing,canAssign:false}); f.page.createUser(); assert.equal(f.requests.length,2);
  f.page.ngOnDestroy();
});
test('duplicate-email creation conflict discovers the account; organization role and assignment failures stay recoverable', async () => {
  const f = await setup({administrator:true}); f.page.createRoleOptions.set([{id:'role',code:'accountant'},{id:'global',code:'superuser'}]);
  f.page.createUserForm.patchValue({email:'shared@example.test'}); f.page.createUser();
  f.requests[0].stream.error({status:409,error:{message:'Email already exists'}}); await pause();
  assert.equal(f.requests[1].url,'/api/v1/users/lookup-email'); f.requests[1].stream.next({data:existing});
  f.page.existingRoleId='global'; f.page.createUser(); assert.match(f.page.createModalError(),/organization role/); assert.equal(f.requests.length,2);
  f.page.existingRoleId='role'; f.page.createUser(); f.requests[2].stream.error({status:500,error:{message:'Assignment failed'}});
  assert.equal(f.page.createModalError(),'Assignment failed'); assert.equal(f.page.submitting(),false); assert.equal(f.page.isCreateModalOpen(),true); assert.equal(f.page.existingUser().id,'shared');
  f.page.createUser(); assert.equal(f.requests.length,4);
});
test('rapid typing debounces lookup and invalid email makes no request; inactive membership retains its role', async () => {
  const f=await setup({administrator:true}); f.page.openCreateModal(); f.page.createUserForm.patchValue({email:'invalid'}); assert.equal(f.page.emailLookupLoading(),false);
  f.page.createUserForm.patchValue({email:'s@example.test'}); f.page.createUserForm.patchValue({email:'shared@example.test'});
  await new Promise(resolve=>setTimeout(resolve,380)); assert.equal(f.requests.length,1); assert.equal(f.requests[0].payload.email,'shared@example.test');
  f.requests[0].stream.next({data:{...existing,inactiveMembership:true,membershipRole:'accountant'}});assert.equal(f.page.existingRoleId,'role');f.page.ngOnDestroy();
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
