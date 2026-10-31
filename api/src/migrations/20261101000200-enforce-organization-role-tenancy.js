'use strict';

const CONSTRAINTS = [
  {
    name: 'organization_user_roles_membership_fk',
    fields: ['organization_id', 'user_id'],
    references: { table: 'organization_users', fields: ['organization_id', 'user_id'] },
  },
  {
    name: 'organization_user_roles_tenant_role_fk',
    fields: ['organization_id', 'role_id'],
    references: { table: 'organization_roles', fields: ['organization_id', 'id'] },
  },
];

async function existingConstraints(q) {
  const [rows] = await q.sequelize.query(`SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_user_roles' AND CONSTRAINT_TYPE = 'FOREIGN KEY'`);
  return new Set(rows.map((row) => row.name));
}

// The database itself refuses an assignment whose role or member belongs to another organization.
module.exports = {
  async up(q) {
    // These rows never granted access: the previous resolver required membership, and the backfill
    // has already created a membership for anyone holding a role through users.organization_id.
    await q.sequelize.query(`DELETE our FROM organization_user_roles our
      LEFT JOIN organization_users ou ON ou.organization_id = our.organization_id AND ou.user_id = our.user_id
      WHERE ou.id IS NULL`);
    const existing = await existingConstraints(q);
    for (const { name, fields, references } of CONSTRAINTS) {
      if (existing.has(name)) continue;
      await q.addConstraint('organization_user_roles', {
        fields, type: 'foreign key', name, references, onDelete: 'CASCADE', onUpdate: 'CASCADE',
      });
    }
  },

  async down(q) {
    const existing = await existingConstraints(q);
    for (const { name } of CONSTRAINTS) {
      if (existing.has(name)) await q.removeConstraint('organization_user_roles', name);
    }
  },
};
