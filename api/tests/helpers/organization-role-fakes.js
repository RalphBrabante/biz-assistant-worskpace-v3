const { Op } = require('sequelize');

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (Op.ne in expected) return row[key] !== expected[Op.ne] && row[key] !== undefined;
      return true;
    }
    return Array.isArray(expected) ? expected.includes(row[key]) : row[key] === expected;
  });
}

// In-memory stand-ins for the organization role tables, enforcing the same uniqueness rules as MySQL.
function addOrganizationRoleFakes(models, { onAssign } = {}) {
  const roles = [], grants = [], assignments = [], audit = [];
  const transaction = models.User?.sequelize?.transaction || ((callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }));

  const withAssociations = (row) => {
    row.permissions ??= [];
    row.update ??= async function update(payload) { Object.assign(this, payload); };
    row.destroy ??= async function destroy() { roles.splice(roles.indexOf(this), 1); };
    return row;
  };

  models.OrganizationRole = {
    sequelize: { transaction },
    findAll: async ({ where } = {}) => roles.filter((role) => matches(role, where)),
    findOne: async ({ where } = {}) => roles.find((role) => matches(role, where)) || null,
    create: async (payload) => {
      if (roles.some((role) => role.organizationId === payload.organizationId
        && (role.code === payload.code || (payload.presetCode && role.presetCode === payload.presetCode)))) {
        throw Object.assign(new Error('duplicate role'), { name: 'SequelizeUniqueConstraintError' });
      }
      const role = withAssociations({ id: `${payload.organizationId}:${payload.code}`, isActive: true, ...payload });
      roles.push(role);
      return role;
    },
  };
  models.OrganizationRolePermission = {
    bulkCreate: async (rows) => { grants.push(...rows); return rows; },
    destroy: async ({ where }) => { grants.splice(0, grants.length, ...grants.filter((row) => !matches(row, where))); },
  };
  const hydrate = (row) => ({
    ...row,
    role: roles.find((role) => role.id === row.roleId),
    destroy: async () => { assignments.splice(assignments.indexOf(row), 1); },
  });
  models.OrganizationUserRole = {
    findAll: async ({ where, include } = {}) => assignments
      .filter((row) => matches(row, where))
      .map(hydrate)
      .filter((row) => !include || (row.role && matches(row.role, include[0].where))),
    create: async (payload, options) => {
      if (onAssign) onAssign(payload, options);
      assignments.push({ ...payload });
      return payload;
    },
    count: async ({ where } = {}) => assignments.filter((row) => matches(row, where)).length,
    destroy: async ({ where }) => { assignments.splice(0, assignments.length, ...assignments.filter((row) => !matches(row, where))); },
  };
  models.OrganizationRoleAuditLog = { create: async (payload) => { audit.push(payload); return payload; } };
  models.Permission ??= {};
  models.Permission.findAll ??= async () => [];
  models.Role ??= {};
  models.Role.findOne ??= async () => null;
  models.Role.findByPk ??= async () => null;
  return { roles, grants, assignments, audit };
}

module.exports = { addOrganizationRoleFakes };
