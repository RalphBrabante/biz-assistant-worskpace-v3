const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function page(){
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/items-page/items-page.component.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,URLSearchParams,require(name){if(name==='@angular/core')return{Component:()=>v=>v};return {};}});
 return Object.create(module.exports.ItemsPageComponent.prototype);
}
test('item save payload retains its own stock threshold including zero',()=>{
 const p=page();for(const threshold of [0,5,100]){const payload=p.buildPayload({name:'Test',type:'product',stock:1.125,reorderLevel:threshold,isActive:true});assert.equal(payload.stock,1.125);assert.equal(payload.reorderLevel,threshold);}
});
test('stock badges distinguish threshold equality, out of stock, and healthy stock',()=>{
 const p=page();assert.equal(p.itemStockBadgeClass({type:'product',stock:5,reorderLevel:5}),'ui-badge-warning');assert.equal(p.itemStockBadgeClass({type:'product',stock:0,reorderLevel:0}),'ui-badge-danger');assert.notEqual(p.itemStockBadgeClass({type:'product',stock:6,reorderLevel:5}),'ui-badge-warning');
});


test('stock display removes only zero decimal suffixes from serialized whole units', () => {
  const p = page();
  for (const [stock, expected] of [
    [0, '0'], [1, '1'], [25, '25'], [999999999, '999999999'],
    ['0.000', '0'], ['1.0', '1'], ['25.00', '25'], ['25.000', '25'],
    ['999999999.000', '999999999'], ['9007199254740993.000', '9007199254740993'],
    [null, '0'], [undefined, '0'],
  ]) assert.equal(p.formatStock(stock), expected);
});

test('stock display never rounds genuine fractions, artifacts or malformed values', () => {
  const p = page();
  for (const stock of [1.5, 1.125, 0.1 + 0.2, 1.0000000000000002,
    '1.500', '1.125', '0.001', '1.0000000000000001', '-1.500', '', 'invalid']) {
    assert.equal(p.formatStock(stock), String(stock));
  }
});

test('formatting leaves the row and save payload unchanged', () => {
  const p = page();
  for (const stock of ['25.000', '1.125']) {
    const row = Object.freeze({ name: 'Synthetic item', type: 'product', stock, reorderLevel: 5, isActive: true });
    const before = p.buildPayload(row);
    const badge = p.itemStockBadgeClass(row);
    p.formatStock(row.stock);
    assert.equal(row.stock, stock);
    assert.deepEqual(p.buildPayload(row), before);
    assert.equal(p.itemStockBadgeClass(row), badge);
  }
});

test('Items stock badge binds to the display formatter', () => {
  const html = fs.readFileSync(require.resolve('../src/app/pages/items-page/items-page.component.html'), 'utf8');
  assert.ok(html.includes('[ngClass]="itemStockBadgeClass(row)"'));
  assert.ok(html.includes('{{ formatStock(row.stock) }}'));
  assert.ok(!html.includes('{{ row.stock ?? 0 }}'));
});

test('Items pagination preserves API row order and raw decimal values across pages', () => {
  const p = page();
  const signal = (value) => {
    const read = () => value;
    read.set = next => { value = next; };
    return read;
  };
  const pages = [
    Object.freeze([Object.freeze({id: 'newest', stock: '25.000'}), Object.freeze({id: 'middle', stock: '0.000'})]),
    Object.freeze([Object.freeze({id: 'oldest', stock: '1.125'})]),
  ];
  const requests = [];
  Object.assign(p, {
    organizationContext: {getActiveOrganizationId: () => 'org-a', isSuperuser: () => false},
    lastVendorScope: 'org-a', filter: signal(''), vendorFilter: '',
    loading: signal(false), error: signal(''), rows: signal([]),
    page: 1, pageSize: 2, total: 0, totalPages: 1,
    persistTablePreferences() {},
    api: {list(url) {
      const params = new URL(url, 'http://fixture').searchParams;
      requests.push(params);
      return {subscribe({next}) {
        const requestedPage = Number(params.get('page'));
        next({data: pages[requestedPage - 1], meta: {page: requestedPage, total: 3, totalPages: 2}});
      }};
    }},
  });
  p.load();
  assert.strictEqual(p.rows(), pages[0]);
  assert.deepEqual(p.rows().map(row => p.formatStock(row.stock)), ['25', '0']);
  assert.deepEqual(p.rows().map((row, i) => p.trackById(i, row)), ['newest', 'middle']);
  p.goToPage(2);
  assert.strictEqual(p.rows(), pages[1]);
  assert.equal(p.formatStock(p.rows()[0].stock), '1.125');
  assert.equal(p.total, 3);
  assert.equal(p.totalPages, 2);
  p.goToPage(3);
  assert.equal(requests.length, 2, 'out-of-range navigation must not request a page');
  p.goToPage(1);
  assert.strictEqual(p.rows(), pages[0]);
  assert.equal(p.rows()[0].stock, '25.000');
  assert.deepEqual(requests.map(params => params.get('page')), ['1', '2', '1']);
  assert.ok(requests.every(params => params.get('limit') === '2'));
});
