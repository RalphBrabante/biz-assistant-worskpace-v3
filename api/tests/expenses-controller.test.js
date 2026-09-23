const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { Op } = require('sequelize');
function setup(code = 'VAT') {
 const writes = [];
 const organization = { id: 'org-a', currency: 'PHP', taxTypeId: 'tax-a', taxType: { code, percentage: code === 'VAT' ? '12.00' : '3.00', isActive: true } };
 const existing = { id: 'expense-a', organizationId: 'org-a', vendorId: 'vendor-a', amount: '11200.00', vatExemptAmount: '0.00', discountAmount: '0.00', serviceCharge: '0.00', receiptVatAmount: '1200.00', withholdingTaxTypeId: 'ewt-a', withHoldingTaxAmount: '200.00', totalAmount: '11000.00', update: async (payload) => { writes.push(payload); Object.assign(existing, payload); } };
 const models = {
  Expense: { findOne: async () => existing, findByPk: async () => existing, create: async (payload) => { writes.push(payload); return { id: 'new', ...payload }; } },
  Vendor: { findOne: async () => ({ id: 'vendor-a', organizationId: 'org-a' }) },
  VendorOrganization: {}, OrganizationUser: { findOne: async () => null }, TaxType: {},
  Organization: { findByPk: async () => organization },
  WithholdingTaxType: { findOne: async ({where}) => {
   assert.equal(where.appliesTo[Op.in].join(','), 'expense,both');
   return where.id === 'ewt-a' && where.organizationId === 'org-a' ? { id: 'ewt-a', percentage: '2.00', minimumBaseAmount: 0 } : null;
  }, findAll: async () => [] },
 };
 const dependencies = {
  '../sequelize': { getModels: () => models },
  '../services/organization-currency': { getOrganizationCurrency: async () => 'PHP' },
  '../services/storage-service': { StorageProviderError: class StorageProviderError extends Error {} },
  '../services/message-service': { createOrganizationMessage: async () => {}, getActorDisplayName: () => 'Test' },
  '../services/request-scope': require('../src/services/request-scope'),
  '../services/expense-calculation': require('../src/services/expense-calculation'),
  '../services/tax-calculation': require('../src/services/tax-calculation'),
 };
 const module = { exports: {} };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/expenses-controller.js'), 'utf8'), {
  module, exports: module.exports, console,
  require: (name) => name in dependencies ? dependencies[name] : require(name),
 });
 const req = { body: { organizationId: 'org-a', vendorId: 'vendor-a', category: 'goods', expenseDate: '2026-09-21', amount: '11200.00', withholdingTaxTypeId: 'ewt-a' }, query: {}, params: { id: 'expense-a' }, auth: { roleCodes: ['superuser'], user: { id: 'user-a', organizationId: 'org-a' } } };
 const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
 return { controller: module.exports, req, res, writes, existing, models, organization };
}
const next = (error) => { throw error; };
test('create stores authoritative VAT, EWT and final payable despite client-supplied totals', async () => {
 const {controller,req,res,writes}=setup(); Object.assign(req.body,{amount:'12200.00',vatExemptAmount:'1000.00',discountAmount:'100.00',taxAmount:999,totalAmount:1});
 await controller.createExpense(req,res,next); assert.equal(res.statusCode,201);
 assert.equal(writes[0].taxAmount,1200); assert.equal(writes[0].withholdingTaxBase,11000); assert.equal(writes[0].withHoldingTaxAmount,220); assert.equal(writes[0].totalAmount,11980);
});
test('FBC records supplier VAT for EWT but never as claimable input VAT', async () => {
 const {controller,req,res,writes}=setup('PT');req.body.receiptVatAmount='1200.00';
 await controller.createExpense(req,res,next);assert.equal(res.statusCode,201);assert.equal(writes[0].receiptVatAmount,1200);assert.equal(writes[0].taxAmount,0);assert.equal(writes[0].withHoldingTaxAmount,200);
});
test('explicit None clears the stored EWT type and amount when editing',async()=>{
 const {controller,req,res,writes}=setup();req.body={withholdingTaxTypeId:''};
 await controller.updateExpense(req,res);assert.equal(res.statusCode,200);assert.equal(writes[0].withholdingTaxTypeId,null);assert.equal(writes[0].withHoldingTaxAmount,0);assert.equal(writes[0].totalAmount,11200);
});
test('omitted EWT selection retains the recorded rate when editing',async()=>{
 const {controller,req,res,writes}=setup();req.body={notes:'Updated note'};
 await controller.updateExpense(req,res);assert.equal(res.statusCode,200);assert.equal(writes[0].withholdingTaxTypeId,'ewt-a');assert.equal(writes[0].withHoldingTaxAmount,200);
});
test('editing cannot calculate using another company tax settings',async()=>{
 const {controller,req,res,writes}=setup();req.body={organizationId:'org-b'};
 await controller.updateExpense(req,res);assert.equal(res.statusCode,400);assert.equal(writes.length,0);
});
test('invalid receipt splits return 400 and do not write an expense',async()=>{
 const {controller,req,res,writes}=setup();req.body.vatExemptAmount='12000.00';
 await controller.createExpense(req,res,next);assert.equal(res.statusCode,400);assert.equal(writes.length,0);
});
test('tax context rejects another company for an unassigned user',async()=>{
 const {controller,req,res}=setup();req.auth.roleCodes=[];req.query.organizationId='org-b';
 await controller.getExpenseTaxContext(req,res);assert.equal(res.statusCode,403);
});
test('tax context works without global organization-management permission',async()=>{
 const {controller,req,res}=setup();req.auth.roleCodes=[];req.query.organizationId='org-a';
 await controller.getExpenseTaxContext(req,res);assert.equal(res.statusCode,200);assert.equal(res.body.data.organization.taxType.code,'VAT');
});
test('CSV import reports malformed financial rows instead of saving zero',async()=>{
 const {controller,req,res,writes,models}=setup(); models.Expense.findOne=async()=>null;
 req.file={buffer:Buffer.from('vendorId,category,expenseDate,amount,receiptVatAmount\nvendor-a,goods,2026-09-21,not-money,0\nvendor-a,goods,2026-09-21,11200,1200\n')};req.body={organizationId:'org-a'};
 await controller.importExpenses(req,res);assert.equal(res.statusCode,200);assert.equal(res.body.data.imported,1);assert.equal(res.body.data.skipped,1);assert.equal(writes[0].taxAmount,1200);
});

for (const source of [
 { code: 'VAT', receiptVatAmount: null, taxAmount: 1200, expectedVat: 1200 },
 { code: 'PT', receiptVatAmount: null, taxAmount: 171.5, expectedVat: 0 },
 { code: 'PT', receiptVatAmount: 1200, taxAmount: 0, expectedVat: 1200 },
]) test(`transfer preserves actual supplier VAT for ${source.code}, stored VAT ${source.receiptVatAmount}`, async () => {
 const { controller, req, res, writes, existing, organization, models } = setup();
 Object.assign(existing, { organizationId: 'source-org', vendorId: null, vendorTaxId: null, withholdingTaxTypeId: null, taxType: { code: source.code }, receiptVatAmount: source.receiptVatAmount, taxAmount: source.taxAmount });
 req.body = { organizationId: 'org-a' };
 await controller.transferExpense(req, res);
 assert.equal(res.statusCode, 200, JSON.stringify(res.body));
 assert.equal(writes[0].receiptVatAmount, source.expectedVat);
 assert.equal(writes[0].taxAmount, source.expectedVat);
 assert.equal(writes[0].totalAmount, 11200);
});

for (const auditFields of [
 { createdBy: 'deleted-user', updatedBy: 'deleted-user' },
 { createdBy: '', updatedBy: '' },
 {},
]) test(`create uses authenticated audit references for ${JSON.stringify(auditFields)}`, async () => {
 const { controller, req, res, writes, models } = setup();
 Object.assign(req.body, auditFields);
 const create = models.Expense.create;
 models.Expense.create = async (payload) => {
  // Only the authenticated user exists in this persistence fixture.
  assert.equal(payload.createdBy, 'user-a');
  assert.equal(payload.updatedBy, 'user-a');
  return create(payload);
 };
 await controller.createExpense(req, res, next);
 assert.equal(res.statusCode, 201);
 assert.equal(writes.length, 1);
});

for (const value of ['', '  ', null, undefined]) test(`create accepts no withholding tax: ${JSON.stringify(value)}`, async () => {
 const { controller, req, res, writes, models } = setup();
 req.body.withholdingTaxTypeId = value;
 const create = models.Expense.create;
 models.Expense.create = async (payload) => {
  // An empty string is not a valid foreign key; no selection must be NULL.
  assert.equal(payload.withholdingTaxTypeId, null);
  return create(payload);
 };
 await controller.createExpense(req, res, next);
 assert.equal(res.statusCode, 201);
 assert.equal(writes[0].withHoldingTaxAmount, 0);
});
