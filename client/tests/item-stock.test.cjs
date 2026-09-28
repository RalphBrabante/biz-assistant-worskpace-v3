const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function page(){
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/items-page/items-page.component.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,require(name){if(name==='@angular/core')return{Component:()=>v=>v};return {};}});
 return Object.create(module.exports.ItemsPageComponent.prototype);
}
test('item save payload retains its own stock threshold including zero',()=>{
 const p=page();for(const threshold of [0,5,100]){const payload=p.buildPayload({name:'Test',type:'product',stock:1.125,reorderLevel:threshold,isActive:true});assert.equal(payload.stock,1.125);assert.equal(payload.reorderLevel,threshold);}
});
test('stock badges distinguish threshold equality, out of stock, and healthy stock',()=>{
 const p=page();assert.equal(p.itemStockBadgeClass({type:'product',stock:5,reorderLevel:5}),'ui-badge-warning');assert.equal(p.itemStockBadgeClass({type:'product',stock:0,reorderLevel:0}),'ui-badge-danger');assert.notEqual(p.itemStockBadgeClass({type:'product',stock:6,reorderLevel:5}),'ui-badge-warning');
});
