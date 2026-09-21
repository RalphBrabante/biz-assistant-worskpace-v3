const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const path = require('node:path');
const filename = path.resolve(__dirname, '../src/controllers/sales-invoices-controller.js');
const originalRequire = createRequire(filename);
function setup({orderExists=true, privileged=true}={}) {
  const lookups=[], writes=[];
  const models = {
    Order: {findOne: async query => {lookups.push(query); return orderExists ? {id:query.where.id} : null;}},
    Organization: {findByPk: async () => ({taxTypeId:'vat',taxType:{code:'VAT',percentage:12,isActive:true}})},
    SalesInvoice: {create: async payload => {writes.push(payload);return {id:'invoice',...payload};}},
  };
  const mocks = {
    '../sequelize': {getModels: () => models},
    '../services/organization-currency': {getOrganizationCurrency: async () => 'PHP'},
    '../services/message-service': {createOrganizationMessage: async () => {}, getActorDisplayName: () => 'Test'},
    '../services/request-scope': {isPrivilegedRequest: () => privileged, getAuthenticatedOrganizationId: () => 'own-org'},
  };
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name => mocks[name] || originalRequire(name),console});
  async function create(orderId) {
    const req={body:{organizationId:'selected-org',orderId,invoiceNumber:'INV-TEST',issueDate:'2026-09-21',amount:112},auth:{user:{id:'actor'}}};
    const res={status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await module.exports.createSalesInvoice(req,res);return res;
  }
  return {create,lookups,writes};
}
test('a linked invoice looks up the order within its organization before insertion',async()=>{
  const e=setup();const res=await e.create('order-1');assert.equal(res.statusCode,201);assert.equal(e.lookups[0].where.organizationId,'selected-org');assert.equal(e.writes[0].orderId,'order-1');
});
test('missing or cross-organization orders cannot be linked to an invoice',async()=>{
  const e=setup({orderExists:false});const res=await e.create('other-order');assert.equal(res.statusCode,400);assert.match(res.body.message,/invoice organization/);assert.equal(e.writes.length,0);
});
test('ordinary users cannot supply another organization to bypass the relationship check',async()=>{
  const e=setup({privileged:false});await e.create('order-1');assert.equal(e.lookups[0].where.organizationId,'own-org');assert.equal(e.writes[0].organizationId,'own-org');
});
test('standalone invoices do not require an order and blank IDs become null',async()=>{
  const e=setup();const res=await e.create('  ');assert.equal(res.statusCode,201);assert.equal(e.lookups.length,0);assert.equal(e.writes[0].orderId,null);
});
