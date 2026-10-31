// The system roles every organization owns. Each organization holds its own copy, provisioned
// from the global template of the same code in the `roles` table.
//
// `locked` roles cannot have their permissions edited: administrators bypass permission checks
// entirely, and accountants are deliberately capped to a fixed read-only set.
// `rank` picks the label stored in organization_users.role when a member holds several.
const ROLE_PRESETS = Object.freeze([
  Object.freeze({ code: 'administrator', name: 'Administrator', rank: 4, locked: true, description: 'Full administrative access to this organization.' }),
  Object.freeze({ code: 'accountant', name: 'Accountant', rank: 3, locked: true, description: 'Read-only accounting and reporting access.' }),
  Object.freeze({ code: 'inventorymanager', name: 'Inventory Manager', rank: 2, locked: false, description: 'Inventory and purchasing access.' }),
  Object.freeze({ code: 'enduser', name: 'End User', rank: 1, locked: false, description: 'Standard day-to-day access.' }),
]);

const PRESET_BY_CODE = new Map(ROLE_PRESETS.map((preset) => [preset.code, preset]));

// Custom roles may not take these codes: they carry meaning elsewhere in the application.
const RESERVED_ROLE_CODES = Object.freeze([...PRESET_BY_CODE.keys(), 'superuser', 'admin', 'superadmin', 'member']);

function isLockedPreset(presetCode) {
  return Boolean(PRESET_BY_CODE.get(presetCode)?.locked);
}

// organization_users.role is a readable label derived from the assignments, never a source of access.
function membershipLabel(presetCodes = []) {
  const held = ROLE_PRESETS.find((preset) => presetCodes.includes(preset.code));
  return held ? held.code : 'member';
}

module.exports = { ROLE_PRESETS, PRESET_BY_CODE, RESERVED_ROLE_CODES, isLockedPreset, membershipLabel };
