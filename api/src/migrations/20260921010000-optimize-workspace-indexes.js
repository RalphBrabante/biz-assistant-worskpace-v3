'use strict';
const { workloadIndexes, duplicateIndexes } = require('../database/schema-indexes-v1');

// MySQL DDL implicitly commits. Validate the entire plan first and make every step
// restartable so an interrupted migration can resume without dropping constraints.
function matches(actual, expected) {
  return !!actual && !actual.primary && Boolean(actual.unique) === expected.unique &&
    (!actual.type || actual.type.toUpperCase() === 'BTREE') &&
    actual.fields.length === expected.fields.length && actual.fields.every((field, i) =>
      field.attribute === expected.fields[i] && !field.length && (!field.order || field.order.toUpperCase() === 'ASC'));
}

async function inspect(queryInterface) {
  const tables = [...new Set([...workloadIndexes, ...duplicateIndexes].map(index => index.table))];
  const state = new Map();
  for (const table of tables) state.set(table, await queryInterface.showIndex(table));
  for (const expected of [...workloadIndexes, ...duplicateIndexes]) {
    for (const name of [expected.name, ...(expected.duplicates || [])]) {
      const actual = state.get(expected.table).find(index => index.name === name);
      if (actual && !matches(actual, expected)) {
        throw new Error(`Schema index conflict: ${expected.table}.${name}. Review its definition before retrying; no indexes were changed.`);
      }
    }
  }
  return state;
}

async function ensure(queryInterface, state, definition, name = definition.name) {
  if (state.get(definition.table).some(index => index.name === name)) return;
  await queryInterface.addIndex(definition.table, definition.fields, { name, unique: definition.unique });
  state.get(definition.table).push({ name });
}

module.exports = {
  async up(queryInterface) {
    const state = await inspect(queryInterface);
    for (const index of workloadIndexes) await ensure(queryInterface, state, index);
    for (const index of duplicateIndexes) {
      // Establish the retained unique index before removing any duplicate.
      await ensure(queryInterface, state, index);
      for (const name of index.duplicates) {
        if (state.get(index.table).some(actual => actual.name === name)) await queryInterface.removeIndex(index.table, name);
      }
    }
  },
  async down(queryInterface) {
    const state = await inspect(queryInterface);
    // Restore the legacy duplicate indexes without ever removing uniqueness.
    for (const index of duplicateIndexes) {
      await ensure(queryInterface, state, index);
      for (const name of index.duplicates) await ensure(queryInterface, state, index, name);
    }
    for (const index of [...workloadIndexes].reverse()) {
      if (state.get(index.table).some(actual => actual.name === index.name)) await queryInterface.removeIndex(index.table, index.name);
    }
  },
};
