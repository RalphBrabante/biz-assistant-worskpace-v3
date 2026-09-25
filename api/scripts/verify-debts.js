// Only targets an empty, disposable localhost database. Never uses the app's DB_* variables.
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {Sequelize, DataTypes: D} = require('sequelize');
const {Debt, DebtPayment, initDebtModels} = require('../src/models/debt');
const database = process.env.DEBT_TEST_DATABASE;
if (!/^debt_test_[a-z0-9_]+$/.test(database || '') || !process.env.DEBT_TEST_PORT || !process.env.DEBT_TEST_PASSWORD) throw new Error('Set DEBT_TEST_DATABASE (debt_test_*), DEBT_TEST_PORT, and DEBT_TEST_PASSWORD for an empty disposable localhost database.');
const sequelize = new Sequelize(database, 'root', process.env.DEBT_TEST_PASSWORD, {host: '127.0.0.1', port: Number(process.env.DEBT_TEST_PORT), dialect: 'mysql', logging: false, pool: {max: 6}});
function response() {return {statusCode: 200, set() {return this;}, status(n) {this.statusCode = n; return this;}, json(body) {this.body = body; return this;}};}
(async () => {
  try {
    await sequelize.authenticate();
    const q = sequelize.getQueryInterface();
    if ((await q.showAllTables()).length) throw new Error('Refusing to use a nonempty test database.');
    const Organization = sequelize.define('Organization', {id: {type: D.UUID, primaryKey: true}, currency: D.STRING(3)}, {tableName: 'organizations', timestamps: false});
    const User = sequelize.define('User', {id: {type: D.UUID, primaryKey: true}, firstName: D.STRING, lastName: D.STRING}, {tableName: 'users', timestamps: false, underscored: true});
    await Organization.sync(); await User.sync();
    await q.createTable('permissions', {id: {type: D.UUID, primaryKey: true}, name: D.STRING, code: D.STRING, resource: D.STRING, action: D.STRING, description: D.TEXT, is_system: D.BOOLEAN, is_active: D.BOOLEAN, created_at: D.DATE, updated_at: D.DATE});
    await require('../src/migrations/20260926000000-create-debts').up(q, D);
    initDebtModels(sequelize); DebtPayment.belongsTo(User, {as: 'author', foreignKey: 'createdBy'});
    const models = {Debt, DebtPayment, Organization};
    const filename = path.resolve(__dirname, '../src/controllers/debts-controller.js'), real = createRequire(filename), module = {exports: {}};
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {module, exports: module.exports, Date, console, require: name => name === '../sequelize' ? {getModels: () => models} : real(name)});
    const c = module.exports, orgId = randomUUID(), userId = randomUUID();
    await Organization.create({id: orgId, currency: 'PHP'}); await User.create({id: userId, firstName: 'Debt', lastName: 'Tester'});
    const req = (body = {}, id, query = {}) => ({body, params: {id}, query, auth: {userId, roleCodes: ['staff'], user: {organizationId: orgId}}});
    async function create(amount) {
      const r = response(); await c.create(req({title: 'Test debt', creditor: 'Test lender', amount, borrowedOn: '2026-09-01', requestKey: randomUUID()}), r);
      assert.equal(r.statusCode, 201, JSON.stringify(r.body)); return r.body.data;
    }
    async function pay(id, amount, requestKey = randomUUID()) {
      const r = response(); await c.pay(req({amount, paidOn: '2026-09-26', requestKey}, id), r); return r;
    }
    const debt = await create('100.00');
    const concurrent = await Promise.all([pay(debt.id, '70.00'), pay(debt.id, '50.00')]);
    assert.deepEqual(concurrent.map(r => r.statusCode).sort(), [201, 409]);
    assert.equal(await DebtPayment.count({where: {debtId: debt.id}}), 1);
    const current = await Debt.findByPk(debt.id); const remaining = (100 - Number(current.paidAmount)).toFixed(2);
    const retryKey = randomUUID(); const repeated = await Promise.all([pay(debt.id, remaining, retryKey), pay(debt.id, remaining, retryKey)]);
    assert.deepEqual(repeated.map(r => r.statusCode).sort(), [200, 201]); assert.equal(await DebtPayment.count({where: {debtId: debt.id}}), 2);
    assert.equal((await Debt.findByPk(debt.id)).paidAmount, '100.00');
    const detail = response(); await c.detail(req({}, debt.id), detail);
    assert.equal(detail.statusCode, 200, JSON.stringify(detail.body)); assert.equal(detail.body.data.debt.remainingAmount, '0.00'); assert.equal(detail.body.data.payments[0].author.firstName, 'Debt');
    const tiny = await create('0.30'); await pay(tiny.id, '0.10'); const full = await pay(tiny.id, '0.20'); assert.equal(full.body.data.debt.remainingAmount, '0.00');
    const rollback = await create('10.00'), originalUpdate = Debt.prototype.update;
    Debt.prototype.update = async () => {throw new Error('Simulated write failure');};
    try {assert.equal((await pay(rollback.id, '1.00')).statusCode, 500);} finally {Debt.prototype.update = originalUpdate;}
    assert.equal(await DebtPayment.count({where: {debtId: rollback.id}}), 0); assert.equal((await Debt.findByPk(rollback.id)).paidAmount, '0.00');
    const totals = response(); await c.list(req({}, undefined, {status: 'paid'}), totals);
    assert.equal(totals.statusCode, 200, JSON.stringify(totals.body)); assert.equal(totals.body.meta.total, 2); assert.equal(totals.body.data.summary[0].paidAmount, '100.30'); assert.equal(totals.body.data.summary[0].remainingAmount, '0.00');
    console.log('PASS: MySQL migration, permission definitions, decimal balances, row-lock concurrency, idempotency, rollback, payment history joins, and grouped totals.');
  } finally {await sequelize.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
