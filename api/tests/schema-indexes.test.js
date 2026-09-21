const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize } = require('sequelize');
const { initModels } = require('../src/models');
const migration = require('../src/migrations/20260921010000-optimize-workspace-indexes');
const { workloadIndexes, duplicateIndexes } = require('../src/database/schema-indexes-v1');

function index(definition, name = definition.name) {
  return { name, unique: definition.unique, type: 'BTREE', primary: false, fields: definition.fields.map(attribute => ({ attribute, length: undefined, order: 'ASC' })) };
}
function fixture() {
  const tables = new Map([...workloadIndexes, ...duplicateIndexes].map(i => [i.table, []]));
  for (const def of duplicateIndexes) tables.get(def.table).push(index(def), ...def.duplicates.map(name => index(def, name)));
  const calls = [];
  const qi = {
    showIndex: async table => structuredClone(tables.get(table)),
    addIndex: async (table, fields, options) => { calls.push(['add', table, options.name]); tables.get(table).push(index({fields, ...options})); },
    removeIndex: async (table, name) => { calls.push(['remove', table, name]); tables.set(table, tables.get(table).filter(i => i.name !== name)); },
  };
  return { tables, calls, qi };
}

test('models define every workload index and each unique key only once', () => {
  const db = new Sequelize('test', 'test', '', {dialect: 'mysql', logging: false});
  const models = Object.values(initModels(db));
  for (const def of [...workloadIndexes, ...duplicateIndexes]) {
    const model = models.find(m => m.tableName === def.table);
    assert.ok(model.options.indexes.some(i => i.name === def.name && i.fields.join() === def.fields.join() && Boolean(i.unique) === def.unique), def.name);
  }
  for (const def of duplicateIndexes) {
    const model = models.find(m => m.tableName === def.table);
    assert.equal(Object.values(model.uniqueKeys).filter(i => i.fields.join() === def.fields.join()).length, 0, `${def.table} attribute-level duplicate`);
  }
  const expense = models.find(m => m.tableName === 'expenses');
  assert.equal(expense.rawAttributes.vendorId.allowNull, true);
  assert.equal(expense.rawAttributes.vendorId.onDelete, 'SET NULL');
  const sharing = models.find(m => m.tableName === 'vendor_organizations');
  for (const attribute of ['createdBy', 'updatedBy']) { assert.equal(sharing.rawAttributes[attribute].references.model, 'users'); assert.equal(sharing.rawAttributes[attribute].onDelete, 'SET NULL'); }
});

test('up adds query indexes, removes only named duplicates, and keeps unique constraints', async () => {
  const f = fixture(); await migration.up(f.qi);
  assert.equal(f.calls.filter(c => c[0] === 'add').length, 11);
  assert.equal(f.calls.filter(c => c[0] === 'remove').length, 9);
  for (const def of duplicateIndexes) assert.ok(f.tables.get(def.table).some(i => i.name === def.name && i.unique));
  const count = f.calls.length; await migration.up(f.qi); assert.equal(f.calls.length, count);
});

test('an interrupted DDL sequence can resume without duplicate indexes', async () => {
  const f = fixture(), add = f.qi.addIndex; let attempts = 0;
  f.qi.addIndex = async (...args) => { if (++attempts === 4) throw new Error('interrupted'); return add(...args); };
  await assert.rejects(migration.up(f.qi), /interrupted/); f.qi.addIndex = add; await migration.up(f.qi);
  for (const def of workloadIndexes) assert.equal(f.tables.get(def.table).filter(i => i.name === def.name).length, 1);
});

test('unexpected definitions fail preflight before any DDL runs', async () => {
  const f = fixture(); f.tables.get('users').find(i => i.name === 'email').fields[0].length = 10;
  await assert.rejects(migration.up(f.qi), /Schema index conflict/); assert.equal(f.calls.length, 0);
});

test('canonical uniqueness is created before removing a legacy duplicate if absent', async () => {
  const f = fixture(); f.tables.set('users', f.tables.get('users').filter(i => i.name !== 'users_email'));
  await migration.up(f.qi);
  assert.ok(f.calls.findIndex(c => c[0] === 'add' && c[2] === 'users_email') < f.calls.findIndex(c => c[0] === 'remove' && c[1] === 'users' && c[2] === 'email'));
});

test('down restores legacy definitions and can be repeated, then upgraded again', async () => {
  const f = fixture(); const before = structuredClone([...f.tables]);
  await migration.up(f.qi); await migration.down(f.qi); await migration.down(f.qi);
  const normalize = tables => tables.map(([t, indexes]) => [t, indexes.map(i => i.name).sort()]);
  assert.deepEqual(normalize([...f.tables]), normalize(before));
  await migration.up(f.qi);
});
