'use strict';
// Opt-in MySQL integration test. Copies table definitions only, never business rows.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Sequelize } = require('sequelize');
const config = require('../src/config/config');
const migration = require('../src/migrations/20260921010000-optimize-workspace-indexes');
const { workloadIndexes, duplicateIndexes } = require('../src/database/schema-indexes-v1');

async function main() {
  const source = config[config.env].database;
  const target = process.env.SCHEMA_TEST_DATABASE || '';
  if (!/^schema_review_test_[a-zA-Z0-9_]+$/.test(target) || target === source || !/^[a-zA-Z0-9_]+$/.test(source)) throw new Error('Set SCHEMA_TEST_DATABASE to a new schema_review_test_* database name.');
  const options = {...config[config.env], database: source, logging: false};
  const admin = new Sequelize(source, options.username, options.password, options);
  let db, created = false;
  try {
    await admin.query(`CREATE DATABASE \`${target}\``); created = true;
    db = new Sequelize(target, options.username, options.password, {...options, database: target});
    const tables = [...new Set([...workloadIndexes, ...duplicateIndexes].map(i => i.table))];
    for (const table of tables) await db.query(`CREATE TABLE \`${table}\` LIKE \`${source}\`.\`${table}\``);
    const qi = db.getQueryInterface();
    // Reconstitute the legacy layout even when the source has already migrated.
    await migration.down(qi);
    const id = randomUUID();
    const insert = `INSERT INTO users (id,first_name,last_name,email,password,created_at,updated_at) VALUES (:id,'Schema','Fixture','schema-fixture@example.invalid','not-a-login',NOW(),NOW())`;
    await db.query(insert, {replacements:{id}});
    const [[before]] = await db.query('SELECT * FROM users WHERE id=:id', {replacements:{id}});
    for (let cycle = 0; cycle < 2; cycle++) {
      await migration.up(qi); await migration.up(qi);
      for (const def of [...workloadIndexes, ...duplicateIndexes]) {
        const actual = (await qi.showIndex(def.table)).find(i => i.name === def.name);
        assert.ok(actual, def.name); assert.deepEqual(actual.fields.map(f => f.attribute), def.fields); assert.equal(actual.unique, def.unique);
        for (const name of def.duplicates || []) assert.equal((await qi.showIndex(def.table)).some(i => i.name === name), false);
      }
      await assert.rejects(db.query(insert, {replacements:{id:randomUUID()}}), error => error.name === 'SequelizeUniqueConstraintError');
      const [[after]] = await db.query('SELECT * FROM users WHERE id=:id', {replacements:{id}}); assert.deepEqual(after, before);
      await migration.down(qi);
    }
    await migration.up(qi);
    console.log('PASS: MySQL migration up/down/up, repeatability, unique-key enforcement, and fixture preservation. No business rows copied.');
  } finally {
    if (db) await db.close();
    if (created) await admin.query(`DROP DATABASE \`${target}\``);
    await admin.close();
  }
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
