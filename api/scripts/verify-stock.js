const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
if (process.env.DB_HOST !== 'stock-test-mysql' || process.env.DB_NAME !== 'stock_test') throw new Error('Use only the disposable stock-test-mysql / stock_test database.');
const { authenticateSequelize, getModels } = require('../src/sequelize');
const { setSocketServer } = require('../src/services/socket-service');
(async () => {
  const db = await authenticateSequelize();
  try {
    if ((await db.getQueryInterface().showAllTables()).length) throw new Error('Refusing to initialize a nonempty database.');
    await db.sync();
    const m = getModels();
    const tax = await m.TaxType.create({code:'NON_VAT',name:'Non VAT',percentage:0});
    const org = await m.Organization.create({name:'Stock fixture',addressLine1:'Test',city:'Test',country:'Philippines',contactEmail:'test@example.invalid',phone:'0',currency:'PHP',taxTypeId:tax.id});
    const events = [];
    setSocketServer({to:room=>({emit:(event,payload)=>events.push({room,event,payload})})});
    const product = await db.transaction(transaction=>m.Item.create({organizationId:org.id,name:'Fractional product',stock:10,reorderLevel:5}, {transaction}));
    const write = values => db.transaction(async transaction => {
      await product.reload({transaction,lock:transaction.LOCK.UPDATE});
      return product.update(values,{transaction});
    });
    const count = ()=>m.Message.count({where:{entityId:product.id}});
    assert.equal(await count(),0);
    await write({stock:5}); assert.equal(await count(),1); assert.equal(events.length,1); assert.equal(events[0].room,`org:${org.id}`); assert.equal(events[0].payload.createdBy,null);
    await write({stock:4.125}); await write({name:'Updated name'}); assert.equal(await count(),1);
    await assert.rejects(db.transaction(async transaction=>{await product.reload({transaction,lock:transaction.LOCK.UPDATE});await product.update({stock:0},{transaction});assert.equal(events.length,1);throw Error('rollback');}),/rollback/);
    await product.reload();assert.equal(Number(product.stock),4.125);assert.equal(await count(),1);assert.equal(events.length,1);
    await write({stock:0});assert.equal(await count(),2);assert.equal(events.at(-1).payload.metadata.status,'out');
    await write({stock:8});await write({stock:5});assert.equal(await count(),3);
    await write({stock:8});await write({reorderLevel:9});assert.equal(await count(),4);
    for (const values of [{stock:-1},{stock:1.0001},{stock:'bad'},{reorderLevel:-1},{reorderLevel:1.5},{reorderLevel:null}]) await assert.rejects(write(values));
    const service = await m.Item.create({organizationId:org.id,name:'Service',type:'service',stock:0,reorderLevel:5});assert.equal(await m.Message.count({where:{entityId:service.id}}),0);
    const inactive = await m.Item.create({organizationId:org.id,name:'Inactive',isActive:false,stock:0});assert.equal(await m.Message.count({where:{entityId:inactive.id}}),0);
    const empty = await db.transaction(transaction=>m.Item.create({organizationId:org.id,name:'Empty',stock:0,reorderLevel:0},{transaction}));assert.equal(await m.Message.count({where:{entityId:empty.id}}),1);
    // Failed alert storage rolls back inventory, rather than losing the warning.
    const original = m.Message.create;
    await write({stock:20});
    try {m.Message.create=async()=>{throw Error('storage failure');};await assert.rejects(write({stock:0}),/storage failure/);} finally {m.Message.create=original;}
    assert.equal(Number((await product.reload()).stock),20);
    console.log('PASS: product thresholds, fractional balances, organization-wide alert delivery, transition deduplication, restock rearming, transaction rollback, validation, service/inactive exclusion, and notification persistence failures.');
    setSocketServer(null);
  } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
