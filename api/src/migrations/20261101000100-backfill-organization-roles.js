'use strict';
const { randomUUID } = require('crypto');
const { ACCOUNTANT_PERMISSIONS } = require('../services/accountant-access');

// Frozen here rather than imported: a migration must keep producing the same result later.
const PRESETS = [
  { code: 'administrator', name: 'Administrator', rank: 4 },
  { code: 'accountant', name: 'Accountant', rank: 3 },
  { code: 'inventorymanager', name: 'Inventory Manager', rank: 2 },
  { code: 'enduser', name: 'End User', rank: 1 },
];
const PRESET_CODES = PRESETS.map((preset) => preset.code);

function freeLabel(taken, base, separator) {
  if (!taken.has(base.toLowerCase())) return base;
  for (let attempt = 2; ; attempt += 1) {
    const candidate = `${base}${separator}${attempt}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

// Reproduces what the previous resolver granted for one user in one organization,
// so that moving to per-organization roles changes nobody's access.
function legacyRoleCodes({ membership, globalCodes, isSuperuser, isPrimaryOrganization }) {
  const membershipRole = membership?.is_active ? String(membership.role || '').toLowerCase() : '';
  if (!isSuperuser && membershipRole === 'accountant') return ['accountant'];
  if (!isSuperuser && PRESET_CODES.includes(membershipRole)) return [membershipRole];
  const codes = [];
  for (const code of globalCodes) {
    if (code === 'superuser' || !isPrimaryOrganization) continue;
    if (code === 'accountant' && membership) continue;
    codes.push(code);
  }
  // Accountants are capped to their read-only preset, whatever else they hold.
  return codes.includes('accountant') ? ['accountant'] : [...new Set(codes)];
}

module.exports = {
  legacyRoleCodes,

  async up(q) {
    await q.sequelize.transaction(async (transaction) => {
      const select = async (sql) => (await q.sequelize.query(sql, { transaction }))[0];
      const now = new Date();

      const organizations = await select('SELECT id FROM organizations');
      if (!organizations.length) return;

      const templates = await select('SELECT id, code, name, description, is_active FROM roles');
      const templateByCode = new Map(templates.map((role) => [String(role.code).toLowerCase(), role]));
      const allPermissions = await select('SELECT id, code FROM permissions WHERE is_active = 1');
      const grants = await select(`SELECT rp.role_id, p.id AS permission_id FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.is_active = 1 AND rp.is_allowed = 1 AND p.is_active = 1`);
      const users = await select('SELECT id, organization_id FROM users');
      const memberships = await select('SELECT id, organization_id, user_id, role, is_active, is_primary FROM organization_users');
      const globalAssignments = await select(`SELECT ur.user_id, r.code FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id WHERE ur.is_active = 1 AND r.is_active = 1`);
      const orgRoles = await select('SELECT id, organization_id, code, name, preset_code, legacy_role_id FROM organization_roles');
      const assignments = await select('SELECT organization_id, role_id, user_id FROM organization_user_roles');

      const audit = [];
      const logAudit = (organizationId, action, details, extra = {}) => audit.push({
        id: randomUUID(), organization_id: organizationId, actor_user_id: null, action,
        role_id: extra.roleId || null, role_name: extra.roleName || null, target_user_id: extra.userId || null,
        details: JSON.stringify(details), created_at: now,
      });

      const rolesInOrganization = new Map(organizations.map((organization) => [organization.id, []]));
      for (const role of orgRoles) rolesInOrganization.get(role.organization_id)?.push(role);

      const permissionsFor = (template, presetCode) => {
        if (presetCode === 'accountant') {
          return allPermissions.filter((permission) => ACCOUNTANT_PERMISSIONS.includes(permission.code)).map((permission) => permission.id);
        }
        if (!template) return presetCode === 'administrator' ? allPermissions.map((permission) => permission.id) : [];
        return grants.filter((grant) => grant.role_id === template.id).map((grant) => grant.permission_id);
      };

      const insertRole = async (organizationId, values, permissionIds) => {
        const role = { id: randomUUID(), organization_id: organizationId, created_at: now, updated_at: now, ...values };
        await q.bulkInsert('organization_roles', [role], { transaction });
        if (permissionIds.length) {
          await q.bulkInsert('organization_role_permissions', [...new Set(permissionIds)].map((permissionId) => ({
            id: randomUUID(), role_id: role.id, permission_id: permissionId, created_at: now, updated_at: now,
          })), { transaction });
        }
        rolesInOrganization.get(organizationId).push(role);
        return role;
      };

      // 1. Every organization receives its own copy of each system role.
      for (const { id: organizationId } of organizations) {
        const roles = rolesInOrganization.get(organizationId);
        for (const preset of PRESETS) {
          if (roles.some((role) => role.preset_code === preset.code)) continue;
          // A custom role may already use a name or code this system role needs.
          for (const clash of roles.filter((role) => !role.preset_code
            && (String(role.code).toLowerCase() === preset.code || String(role.name).toLowerCase() === preset.name.toLowerCase()))) {
            const takenCodes = new Set(roles.map((role) => String(role.code).toLowerCase()));
            const takenNames = new Set(roles.map((role) => String(role.name).toLowerCase()));
            const previous = { code: clash.code, name: clash.name };
            clash.code = String(clash.code).toLowerCase() === preset.code ? freeLabel(takenCodes, `custom_${clash.code}`, '_') : clash.code;
            clash.name = String(clash.name).toLowerCase() === preset.name.toLowerCase() ? freeLabel(takenNames, `${clash.name} (custom)`, ' ') : clash.name;
            await q.bulkUpdate('organization_roles', { code: clash.code, name: clash.name, updated_at: now }, { id: clash.id }, { transaction });
            logAudit(organizationId, 'migration.custom_role_renamed', { previous }, { roleId: clash.id, roleName: clash.name });
          }
          const template = templateByCode.get(preset.code);
          await insertRole(organizationId, {
            preset_code: preset.code, code: preset.code, name: preset.name,
            description: template?.description || null, is_active: template ? template.is_active : true,
          }, permissionsFor(template, preset.code));
        }
        logAudit(organizationId, 'migration.catalogue_provisioned', { presets: PRESET_CODES });
      }

      // 2. Translate each member's access into assignments owned by that organization.
      const membershipKey = (organizationId, userId) => `${organizationId}:${userId}`;
      const membershipByKey = new Map(memberships.map((row) => [membershipKey(row.organization_id, row.user_id), row]));
      const globalCodesByUser = new Map();
      for (const row of globalAssignments) {
        if (!globalCodesByUser.has(row.user_id)) globalCodesByUser.set(row.user_id, []);
        globalCodesByUser.get(row.user_id).push(String(row.code).toLowerCase());
      }
      const assigned = new Set(assignments.map((row) => `${row.organization_id}:${row.role_id}:${row.user_id}`));
      const organizationIds = new Set(organizations.map((organization) => organization.id));
      const primaryMemberUsers = new Set(memberships.filter((row) => row.is_primary && row.is_active).map((row) => row.user_id));

      const pairs = memberships.map((row) => ({ organizationId: row.organization_id, userId: row.user_id }));
      for (const user of users) {
        if (user.organization_id && organizationIds.has(user.organization_id) && !membershipByKey.has(membershipKey(user.organization_id, user.id))) {
          pairs.push({ organizationId: user.organization_id, userId: user.id });
        }
      }
      const primaryOrganizationByUser = new Map(users.map((user) => [user.id, user.organization_id]));

      for (const { organizationId, userId } of pairs) {
        let membership = membershipByKey.get(membershipKey(organizationId, userId));
        // Removed members keep their role label; reinstating them restores it.
        if (membership && !membership.is_active) continue;

        const globalCodes = globalCodesByUser.get(userId) || [];
        const isSuperuser = globalCodes.includes('superuser');
        const codes = legacyRoleCodes({
          membership, globalCodes, isSuperuser,
          isPrimaryOrganization: primaryOrganizationByUser.get(userId) === organizationId,
        });
        const roles = rolesInOrganization.get(organizationId);

        const targets = [];
        for (const code of codes) {
          let role = roles.find((candidate) => candidate.preset_code === code);
          if (!role) {
            const template = templateByCode.get(code);
            role = template && roles.find((candidate) => candidate.legacy_role_id === template.id);
            if (!role && template) {
              const takenCodes = new Set(roles.map((candidate) => String(candidate.code).toLowerCase()));
              const takenNames = new Set(roles.map((candidate) => String(candidate.name).toLowerCase()));
              role = await insertRole(organizationId, {
                legacy_role_id: template.id,
                code: freeLabel(takenCodes, code, '_'),
                name: freeLabel(takenNames, template.name, ' '),
                description: template.description || null,
                is_active: true,
              }, permissionsFor(template, null));
            }
          }
          if (role) targets.push(role);
        }

        // Fallback members become real rows so the database can enforce their assignments,
        // including custom roles they already hold.
        const holdsAssignment = assignments.some((row) => row.organization_id === organizationId && row.user_id === userId);
        const createdMembership = !membership && (targets.length > 0 || holdsAssignment);
        if (createdMembership) {
          membership = {
            id: randomUUID(), organization_id: organizationId, user_id: userId, role: 'member',
            is_active: true, is_primary: !primaryMemberUsers.has(userId), created_at: now, updated_at: now,
          };
          await q.bulkInsert('organization_users', [membership], { transaction });
          membershipByKey.set(membershipKey(organizationId, userId), membership);
          if (membership.is_primary) primaryMemberUsers.add(userId);
        }
        if (!membership) continue;

        for (const role of targets) {
          const key = `${organizationId}:${role.id}:${userId}`;
          if (assigned.has(key)) continue;
          assigned.add(key);
          await q.bulkInsert('organization_user_roles', [{
            id: randomUUID(), organization_id: organizationId, role_id: role.id, user_id: userId, created_at: now, updated_at: now,
          }], { transaction });
        }

        // organization_users.role becomes a readable label for the member's highest system role.
        if (!isSuperuser) {
          const held = PRESETS.find((preset) => targets.some((role) => role.preset_code === preset.code));
          const nextRole = held ? held.code : 'member';
          const previousRole = membership.role;
          if (previousRole !== nextRole) {
            await q.bulkUpdate('organization_users', { role: nextRole, updated_at: now }, { id: membership.id }, { transaction });
          }
          if (previousRole !== nextRole || createdMembership) {
            logAudit(organizationId, 'migration.member_backfilled', { previousRole, role: nextRole, codes, createdMembership }, { userId });
          }
        }
      }

      if (audit.length) await q.bulkInsert('organization_role_audit_logs', audit, { transaction });
    });
  },

  // Returns to the previous model. Renamed custom roles get their names back and catalogue rows are
  // removed. A label is restored only if nothing has changed it since: restoring one over a later
  // demotion would hand back access that was revoked. Fallback membership rows stay, because chat
  // history may reference them, and keep their label because the previous resolver ignores a global
  // accountant once a membership exists.
  async down(q) {
    await q.sequelize.transaction(async (transaction) => {
      const [rows] = await q.sequelize.query(
        "SELECT organization_id, action, role_id, target_user_id, details FROM organization_role_audit_logs WHERE action IN ('migration.member_backfilled', 'migration.custom_role_renamed')",
        { transaction },
      );
      // System roles go first, so a renamed custom role can take its original name and code back.
      await q.sequelize.query('DELETE FROM organization_roles WHERE preset_code IS NOT NULL OR legacy_role_id IS NOT NULL', { transaction });
      for (const row of rows) {
        const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
        if (row.action === 'migration.member_backfilled') {
          if (details.createdMembership) continue;
          await q.bulkUpdate('organization_users', { role: details.previousRole }, { organization_id: row.organization_id, user_id: row.target_user_id, role: details.role }, { transaction });
        } else {
          await q.bulkUpdate('organization_roles', { code: details.previous.code, name: details.previous.name }, { id: row.role_id }, { transaction });
        }
      }
      await q.sequelize.query("DELETE FROM organization_role_audit_logs WHERE action LIKE 'migration.%'", { transaction });
    });
  },
};
