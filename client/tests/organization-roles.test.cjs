const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), rx = require('rxjs');

const app = path.join(__dirname, '../src/app');
const read = (file) => fs.readFileSync(path.join(app, file), 'utf8');

function setup({ organizationId = 'org-1' } = {}) {
  const calls = [];
  const respond = (method) => (url, ...rest) => {
    calls.push({ method, url, payload: rest[0] });
    return rx.of({ data: url.includes('/options') ? { permissions: [], members: [] } : [], message: 'ok', meta: {} });
  };
  const api = {
    getFresh: respond('get'), create: respond('post'), put: respond('put'),
    remove: (url, id) => { calls.push({ method: 'delete', url: `${url}/${id}` }); return rx.of({ data: null }); },
  };
  const organizations = { selectedOrganizationId: () => organizationId, getActiveOrganizationId: () => organizationId };
  const confirmDialog = { confirm: async () => true };
  const deps = { api, auth: { currentUser: () => ({}) }, confirm: confirmDialog, organizations };
  const mocks = {
    '@angular/core': { Component: () => (value) => value, inject: (key) => deps[key], effect: (fn) => fn() },
    '@angular/common': {}, '@angular/forms': {}, rxjs: rx,
    '../../core/api.service': { ApiService: 'api' },
    '../../core/auth.service': { AuthService: 'auth' },
    '../../core/confirm-dialog.service': { ConfirmDialogService: 'confirm' },
    '../../core/organization-context.service': { OrganizationContextService: 'organizations' },
    '../../core/table-preferences': { loadTablePreferences: () => ({}), saveTablePreferences() {}, toPositiveInt: (value, fallback) => Number(value) || fallback, toTableViewMode: () => 'table' },
  };
  const code = ts.transpileModule(read('pages/organization-roles-page/organization-roles-page.component.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams, Map, Set, Math, require: (name) => mocks[name] || {} });
  const page = new module.exports.OrganizationRolesPageComponent();
  return { page, calls, confirmDialog };
}
const role = (overrides = {}) => ({ id: 'r1', name: 'Cashier', code: 'cashier', description: '', isActive: true, isSystem: false, presetCode: null, permissionsLocked: false, canReset: false, permissions: [], members: [], memberCount: 0, ...overrides });

test('every request names the organization, and nothing loads until one is selected', () => {
  const { calls } = setup();
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((call) => call.url.includes('organizationId=org-1')));
  assert.equal(setup({ organizationId: '' }).calls.length, 0);
});

test('filters follow the data page standard', () => {
  const { page } = setup();
  page.rows = [role(), role({ id: 'r2', name: 'End User', code: 'enduser', isSystem: true, presetCode: 'enduser' }), role({ id: 'r3', name: 'Old', code: 'old', isActive: false })];
  assert.equal(page.hasActiveFilters, false);
  page.typeFilter = 'system';
  assert.deepEqual(page.filteredRows.map((row) => row.id), ['r2']);
  page.typeFilter = ''; page.statusFilter = 'disabled'; page.searchQuery = 'old';
  assert.deepEqual(page.filteredRows.map((row) => row.id), ['r3']);
  assert.equal(page.activeFilterCount, 2);
  page.clearFilters();
  assert.equal(page.hasActiveFilters, false);
  assert.equal(page.filteredRows.length, 3);
});

test('a new role is sent with its permissions, and its code follows the name until edited', () => {
  const { page, calls } = setup();
  page.openCreate();
  page.onNameChange('Front Desk 2');
  assert.equal(page.editor.code, 'front_desk_2');
  page.onCodeChange('frontdesk');
  page.onNameChange('Front Desk');
  assert.equal(page.editor.code, 'frontdesk');
  page.togglePermission('p1', true);
  calls.length = 0;
  page.saveEditor();
  const created = calls.find((call) => call.method === 'post');
  assert.deepEqual(JSON.parse(JSON.stringify(created.payload)), { name: 'Front Desk', description: '', code: 'frontdesk', isActive: true, permissionIds: ['p1'] });
  assert.equal(page.editorOpen, false);
});

test('invalid details are not submitted', () => {
  const { page, calls } = setup();
  page.openCreate();
  page.onNameChange('');
  calls.length = 0;
  page.saveEditor();
  assert.equal(calls.length, 0);
  assert.equal(page.editorOpen, true);
  assert.ok(page.nameError());
  page.onNameChange('Valid');
  page.onCodeChange('9 bad code');
  page.saveEditor();
  assert.equal(calls.length, 0);
  assert.ok(page.codeError());
});

test('locked system roles save details only; their permissions are never sent', () => {
  const { page, calls } = setup();
  page.openEdit(role({ id: 'admin', name: 'Administrator', code: 'administrator', isSystem: true, presetCode: 'administrator', permissionsLocked: true }));
  assert.match(page.editor.lockedNote, /full access/);
  calls.length = 0;
  page.saveEditor();
  const puts = calls.filter((call) => call.method === 'put');
  assert.equal(puts.length, 1);
  assert.ok(!puts[0].url.includes('/permissions'));
  assert.equal(puts[0].payload.code, undefined);
  assert.equal(puts[0].payload.isActive, undefined);
});

test('editable roles save details and permissions together', () => {
  const { page, calls } = setup();
  page.openEdit(role({ permissions: [{ id: 'held' }] }));
  page.togglePermission('added', true);
  calls.length = 0;
  page.saveEditor();
  const puts = calls.filter((call) => call.method === 'put');
  assert.equal(puts.length, 2);
  assert.ok(puts[1].url.includes('/r1/permissions'));
  assert.deepEqual([...puts[1].payload.permissionIds].sort(), ['added', 'held']);
});

test('deleting and removing members stay inside the selected organization', async () => {
  const { page, calls } = setup();
  await page.deleteRole(role());
  assert.ok(calls.some((call) => call.method === 'delete' && call.url === '/api/v1/organization-roles/r1?organizationId=org-1'));
  page.openMembers(role({ members: [{ id: 'u1' }] }));
  page.removeMember({ id: 'u1' });
  assert.ok(calls.some((call) => call.method === 'delete' && call.url === '/api/v1/organization-roles/r1/members/u1?organizationId=org-1'));
});

test('a server refusal stays visible, such as removing the last administrator', () => {
  const { page } = setup();
  page.openMembers(role());
  page.api.remove = () => rx.throwError(() => ({ error: { message: 'This is the organization’s last administrator.' } }));
  page.removeMember({ id: 'u1' });
  assert.match(page.membersError, /last administrator/);
  assert.equal(page.submitting, false);
});

test('activity shows readable descriptions of each change', () => {
  const { page } = setup();
  assert.equal(page.actionLabel({ action: 'member.role_assigned' }), 'Assigned role');
  assert.equal(page.actionLabel({ action: 'future.thing' }), 'Future.Thing');
  assert.equal(page.auditSummary({ targetUser: { firstName: 'Ana', lastName: 'Cruz' }, details: { added: ['orders.read'], removed: ['items.read'] } }), 'Ana Cruz · added orders.read · removed items.read');
  assert.equal(page.personName(null), 'System');
});

test('the route and navigation point administrators at organization roles and keep templates with superusers', () => {
  const routes = read('app.routes.ts'), shell = read('layout/app-shell.component.ts');
  assert.match(routes, /path: 'organization-roles'[^\n]*canActivate: \[administratorGuard\]/);
  assert.match(routes, /path: 'roles', component: RolesPageComponent, canActivate: \[superuserGuard, permissionGuard\]/);
  assert.match(routes, /path: 'roles\/:id', component: RoleDetailPageComponent, canActivate: \[superuserGuard, permissionGuard\]/);
  assert.match(shell, /label: 'Roles', path: '\/organization-roles'[^\n]*adminOnly: true/);
  assert.match(shell, /label: 'Role templates', path: '\/roles'[^\n]*superuserOnly: true/);
});

test('the page follows the filter card and modal loading standards', () => {
  const html = read('pages/organization-roles-page/organization-roles-page.component.html');
  for (const hook of ['hasActiveFilters', 'activeFilterCount', 'clearFilters()', 'view-toggle-group', 'modal-loading-overlay', '[class.pointer-events-none]="submitting"', 'field-validation-icon', 'aria-label="Remove filter"']) {
    assert.ok(html.includes(hook), hook);
  }
});
