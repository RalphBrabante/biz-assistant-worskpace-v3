const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Op} = require('sequelize');
const {localDate, delayUntilMorning, reminderMessage, sendOverdueReminders} = require('../src/jobs/debt-reminder-job');
test('morning schedule uses UTC+8 regardless of server timezone', () => {
  assert.equal(localDate(new Date('2026-09-27T16:00:00Z')), '2026-09-28');
  assert.equal(delayUntilMorning(new Date('2026-09-27T23:59:00Z')), 60000);
  assert.equal(delayUntilMorning(new Date('2026-09-28T00:00:00Z')), 86400000);
  assert.equal(delayUntilMorning(new Date('2026-09-28T04:00:00Z')), 72000000);
});
const debt = {title: '<Loan>', creditor: 'A & B', originalAmount: '100.00', paidAmount: '25.00', currency: 'PHP', dueOn: '2026-09-27'};
test('email contains remaining balance and safely escapes debt text', () => {
  const message = reminderMessage({name: '<Org>', contactEmail: 'org@example.com'}, [debt], '2026-09-28');
  assert.equal(message.toEmail, 'org@example.com'); assert.match(message.text, /PHP 75.00 remaining/);
  assert.match(message.html, /&lt;Loan&gt;/); assert.match(message.html, /A &amp; B/); assert.doesNotMatch(message.html, /<Org>/);
});
function fixture() {
  const sent = new Set(), messages = []; let debts = [debt], fail = false;
  const sequelize = {
    async transaction(fn) {return fn({});},
    async query(sql, {replacements: {org, day}}) {
      const key = org + day;
      if (sql.startsWith('SELECT')) return [[{sent_at: sent.has(key) ? new Date() : null}]];
      if (sql.startsWith('UPDATE')) sent.add(key);
      return [[], {}];
    },
  };
  const models = {
    Organization: {async findAll(options) {assert.equal(options.where.isActive, true); return [{id:'a', name:'Org', contactEmail:'org@example.com'}];}},
    Debt: {sequelize, async findAll(options) {
      assert.equal(options.where.organizationId, 'a'); assert.equal(options.where.dueOn[Op.lt], '2026-09-28');
      assert.equal(options.where[Op.and].comparator, Op.lt); assert.equal(options.where[Op.and].attribute.col, 'paid_amount'); assert.equal(options.where[Op.and].logic.col, 'original_amount');
      return debts;
    }},
  };
  return {models, messages, sent, send: async message => {if (fail) throw new Error('delivery failed'); messages.push(message);}, empty: () => {debts=[];}, fail: value => {fail=value;}};
}
test('one organization digest per day; repeat runs skip delivered reminders', async () => {
  const env = fixture(), now = new Date('2026-09-28T00:00:00Z');
  assert.equal((await sendOverdueReminders(now, env)).sent, 1);
  assert.equal((await sendOverdueReminders(now, env)).sent, 0); assert.equal(env.messages.length, 1);
});
test('no overdue debts sends no email; failed delivery remains retryable', async () => {
  const now = new Date('2026-09-28T00:00:00Z'), empty = fixture(); empty.empty();
  assert.equal((await sendOverdueReminders(now, empty)).sent, 0); assert.equal(empty.messages.length, 0);
  const env = fixture(); env.fail(true); assert.equal((await sendOverdueReminders(now, env)).failed, 1); assert.equal(env.sent.size, 0);
  env.fail(false); assert.equal((await sendOverdueReminders(now, env)).sent, 1);
});
