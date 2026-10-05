// This preset is intentionally capped, even if an old global role still has write grants.
const ACCOUNTANT_PERMISSIONS = Object.freeze([
  'reports.read', 'reports.generate', 'expenses.read', 'sales_invoices.read',
  'vendors.read', 'customers.read', 'withholding_tax_types.read', 'profile.manage',
]);

const ORGANIZATION_PRESET_ROLES = Object.freeze(['administrator', 'enduser', 'accountant', 'inventorymanager']);
const ACCOUNTANT_MESSAGE_TYPES = Object.freeze(['expense', 'sales_invoice', 'customer', 'vendor', 'report']);
function isAccountant(roleCodes = []) { return roleCodes.includes('accountant') && !roleCodes.includes('superuser'); }
module.exports = { ORGANIZATION_PRESET_ROLES, ACCOUNTANT_PERMISSIONS, ACCOUNTANT_MESSAGE_TYPES, isAccountant };
