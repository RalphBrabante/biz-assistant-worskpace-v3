const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function page(){
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/items-page/items-page.component.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,require(name){if(name==='@angular/core')return{Component:()=>v=>v};return {};}});
 return Object.create(module.exports.ItemsPageComponent.prototype);
}
test('item save payload retains its own stock threshold including zero',()=>{
 const p=page();for(const threshold of [0,5,100]){const payload=p.buildPayload({name:'Test',type:'product',stock:12,reorderLevel:threshold,isActive:true});assert.equal(payload.stock,12);assert.equal(payload.reorderLevel,threshold);}
});
test('stock badges distinguish threshold equality, out of stock, and healthy stock',()=>{
 const p=page();assert.equal(p.itemStockBadgeClass({type:'product',stock:5,reorderLevel:5}),'ui-badge-warning');assert.equal(p.itemStockBadgeClass({type:'product',stock:0,reorderLevel:0}),'ui-badge-danger');assert.notEqual(p.itemStockBadgeClass({type:'product',stock:6,reorderLevel:5}),'ui-badge-warning');
});

test('stock display removes database decimal padding',()=>{
 const p=page();
 for(const [value,expected] of [['17472.000','17,472'],['24.000','24'],['0.000','0'],['1.000','1'],[null,'0']]) assert.equal(p.formatStock(value),expected);
 assert.equal(p.formatStock('1.500'),'1.5'); // Historical fractions must not be silently rounded.
});
test('stock input accepts whole quantities and rejects fractions and invalid values',()=>{
 const p=page();
 for(const value of [0,1,17472,'24.000',999999999]) assert.equal(p.isValidStock(value),true);
 for(const value of [1.5,0.001,-1,Infinity,NaN,'bad','',null,true,1000000000]) assert.equal(p.isValidStock(value),false);
});
test('fractional edit cannot reach confirmation or the API',async()=>{
 const p=page();p.editingId='item';p.editForm={stock:1.5};
 Object.defineProperty(p,'isContextLocked',{value:false});
 p.confirmDialog={confirm(){assert.fail('Invalid stock must not reach confirmation');}};
 p.api={update(){assert.fail('Invalid stock must not be saved');}};
 await p.saveEdit();
});
