'use strict';

// Versioned migration definitions. Keep these stable; future changes need a new version.
const workloadIndexes = [
  ['expenses', 'expenses_org_created_idx', ['organization_id', 'created_at']],
  ['expenses', 'expenses_org_status_created_idx', ['organization_id', 'status', 'created_at']],
  ['expenses', 'expenses_org_date_idx', ['organization_id', 'expense_date']],
  ['sales_invoices', 'sales_invoices_org_created_idx', ['organization_id', 'created_at']],
  ['sales_invoices', 'sales_invoices_org_status_created_idx', ['organization_id', 'status', 'created_at']],
  ['sales_invoices', 'sales_invoices_org_date_idx', ['organization_id', 'issue_date']],
  ['orders', 'orders_org_created_idx', ['organization_id', 'created_at']],
  ['orders', 'orders_org_status_created_idx', ['organization_id', 'status', 'created_at']],
  ['messages', 'messages_org_created_idx', ['organization_id', 'created_at']],
  ['messages', 'messages_org_read_created_idx', ['organization_id', 'is_read', 'created_at']],
  ['order_activities', 'order_activities_order_created_idx', ['order_id', 'created_at']],
].map(([table, name, fields]) => ({ table, name, fields, unique: false }));

const duplicateIndexes = [
  ['app_settings', 'app_settings_key_uq', ['key'], ['key']],
  ['licenses', 'licenses_key', ['key'], ['key', 'key_2']],
  ['permissions', 'permissions_code', ['code'], ['code']],
  ['roles', 'roles_code', ['code'], ['code']],
  ['roles', 'roles_name', ['name'], ['name']],
  ['tax_types', 'tax_types_code_uq', ['code'], ['code']],
  ['tokens', 'tokens_token_hash', ['token_hash'], ['token_hash']],
  ['users', 'users_email', ['email'], ['email']],
].map(([table, name, fields, duplicates]) => ({ table, name, fields, duplicates, unique: true }));

function indexesFor(table) {
  return workloadIndexes.filter(index => index.table === table).map(({ name, fields, unique }) => ({ name, fields: [...fields], unique }));
}

module.exports = { workloadIndexes, duplicateIndexes, indexesFor };
