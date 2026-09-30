const {test}=require('node:test');
const assert=require('node:assert/strict');
const {stockStatus,validateInventory}=require('../src/services/stock-alerts');
test('threshold boundaries include equality and zero disables only low-stock warnings',()=>{
 for(const [stock,reorderLevel,expected] of [[6,5,'normal'],[5,5,'low'],[0.125,1,'low'],[0,0,'out'],[0.125,0,'normal']])assert.equal(stockStatus({type:'product',isActive:true,stock,reorderLevel}),expected);
 assert.equal(stockStatus({type:'service',stock:0,reorderLevel:5}),'normal');
 assert.equal(stockStatus({type:'product',isActive:false,stock:0,reorderLevel:5}),'normal');
});
test('inventory validation rejects rounding, negative, nonfinite and fractional thresholds',()=>{
 for(const stock of [-1,Infinity,NaN,'no',null,'',true,1.0001,1.5,0.001,'10.999',1000000000,[],{},'   '])assert.throws(()=>validateInventory({stock,reorderLevel:0}));
 for(const reorderLevel of [-1,1.5,Infinity,null,'',true])assert.throws(()=>validateInventory({stock:1,reorderLevel}));
 for(const stock of [0,1,17472,'24.000',999999999])assert.doesNotThrow(()=>validateInventory({stock,reorderLevel:5}));
});
test('legacy stock deduction preserves fractional balances',async()=>{
 const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
 const filename=require.resolve('../src/controllers/orders-controller');
 const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
 loaded._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.testDeduct=applyStockDeduction;',filename);
 const item={id:'a',stock:'10.000',name:'Measured product',async update(values){this.stock=values.stock;}};
 await loaded.exports.testDeduct(new Map([['a',item]]),new Map([['a',1.125]]),{});
 assert.equal(item.stock,8.875);
 await assert.rejects(loaded.exports.testDeduct(new Map([['a',item]]),new Map([['a',9]]),{}),/exceeds/);
 assert.equal(item.stock,8.875);
});
test('item model enforces whole stock before persistence',async()=>{
 const {Sequelize}=require('sequelize');
 const {initItemModel}=require('../src/models/item');
 const db=new Sequelize('test','test','test',{dialect:'mysql',logging:false});
 try {
  const Item=initItemModel(db);
  for(const stock of [1.5,'0.001']) {
   const item=Item.build({organizationId:'00000000-0000-4000-8000-000000000001',name:'Test',stock});
   await assert.rejects(item.validate(),error=>error.status===400 && /whole number/.test(error.message));
  }
  const item=Item.build({organizationId:'00000000-0000-4000-8000-000000000001',name:'Test',stock:'17472.000'});
  await item.validate();
  item.stock=2.5;
  await assert.rejects(item.validate(),/whole number/);
 } finally {await db.close();}
});
