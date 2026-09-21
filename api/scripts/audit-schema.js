'use strict';
// Read-only metadata and aggregate integrity checks; emits no record values or credentials.
const { authenticateSequelize, getModels } = require('../src/sequelize');

async function main() {
  const db = await authenticateSequelize();
  try {
    const [foreignKeys] = await db.query(`SELECT k.TABLE_NAME tableName, k.COLUMN_NAME columnName,
      k.REFERENCED_TABLE_NAME target, k.REFERENCED_COLUMN_NAME targetColumn,
      r.DELETE_RULE deleteRule, r.UPDATE_RULE updateRule
      FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
      WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`);
    const [indexes] = await db.query(`SELECT TABLE_NAME tableName, INDEX_NAME name, NON_UNIQUE nonUnique,
      GROUP_CONCAT(CONCAT(COLUMN_NAME,':',COALESCE(SUB_PART,''),':',COALESCE(COLLATION,'')) ORDER BY SEQ_IN_INDEX) signature,
      INDEX_TYPE indexType FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
      GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE,INDEX_TYPE`);
    const relationshipDrift = [], orphans = [];
    for (const model of Object.values(getModels())) {
      for (const attr of Object.values(model.rawAttributes)) {
        if (!attr.references) continue;
        const actual = foreignKeys.find(f => f.tableName === model.tableName && f.columnName === attr.field);
        if (!actual || actual.target !== attr.references.model || actual.deleteRule !== attr.onDelete || actual.updateRule !== attr.onUpdate) relationshipDrift.push({table: model.tableName, column: attr.field, expectedTarget: attr.references.model, expectedDelete: attr.onDelete, actual: actual || null});
      }
    }
    const quote = value => db.getQueryInterface().queryGenerator.quoteIdentifier(value);
    for (const fk of foreignKeys) {
      const [[result]] = await db.query(`SELECT COUNT(*) count FROM ${quote(fk.tableName)} c LEFT JOIN ${quote(fk.target)} p ON c.${quote(fk.columnName)}=p.${quote(fk.targetColumn)} WHERE c.${quote(fk.columnName)} IS NOT NULL AND p.${quote(fk.targetColumn)} IS NULL`);
      if (Number(result.count)) orphans.push({table: fk.tableName, column: fk.columnName, count: Number(result.count)});
    }
    const duplicateIndexes = [];
    const groups = new Map();
    for (const index of indexes.filter(i => i.tableName !== 'SequelizeMeta')) {
      const key = [index.tableName, index.nonUnique, index.indexType, index.signature].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(index);
    }
    for (const group of groups.values()) if (group.length > 1) duplicateIndexes.push({table: group[0].tableName, indexes: group.map(i => i.name)});
    const scopeChecks = {
      invoiceOrder: 'SELECT COUNT(*) count FROM sales_invoices c JOIN orders p ON p.id=c.order_id WHERE c.organization_id<>p.organization_id',
      orderCustomer: 'SELECT COUNT(*) count FROM orders c JOIN customers p ON p.id=c.customer_id WHERE c.organization_id<>p.organization_id',
      orderActivity: 'SELECT COUNT(*) count FROM order_activities c JOIN orders p ON p.id=c.order_id WHERE c.organization_id<>p.organization_id',
    };
    const crossOrganizationLinks = {};
    for (const [name, sql] of Object.entries(scopeChecks)) { const [[result]] = await db.query(sql); crossOrganizationLinks[name] = Number(result.count); }
    console.log(JSON.stringify({foreignKeysChecked: foreignKeys.length, relationshipDrift, orphans, duplicateIndexes, crossOrganizationLinks}, null, 2));
  } finally { await db.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
