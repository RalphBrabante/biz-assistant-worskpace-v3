const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),rx=require('rxjs'),{randomUUID}=require('node:crypto');
function setup(){
 const requests=[],effects=[],downloads=[];const deps={AuthService:{isPrivileged:()=>true,hasPermission:()=>true,currentUser:()=>({})},OrganizationContextService:{getActiveOrganizationId:()=>'org-a',selectedOrganizationId:()=>'org-a'}};
 deps.ApiService=new Proxy({},{get:(_,method)=>(url,body)=>{const stream=new rx.Subject();requests.push({method,url,body,stream});return stream;}});
 const source=ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/banks-page/banks-page.component.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,Date,Intl,URLSearchParams,Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},document:{createElement:()=>({click(){}})},setTimeout:fn=>fn(),crypto:{randomUUID},require(name){if(name==='rxjs')return rx;if(name==='@angular/core')return{Component:()=>value=>value,inject:key=>deps[key],effect:fn=>effects.push(fn)};return new Proxy({},{get:(_,key)=>key});}});
 const page=new module.exports.BanksPageComponent(),account={id:'a',name:'Operating',bankName:'Bank',lastFour:'1234',currency:'PHP',balance:'100.10',isArchived:false,notes:''};page.accounts=[account,{...account,id:'b',name:'Savings'}];return{page,account,requests,effects,deps,downloads};
}
test('transaction forms validate exact amounts, funds, dates and transfer destinations',()=>{
 const {page,account}=setup();page.openTransaction('withdrawal',account);page.transaction.amount='100.10';assert.equal(page.validTransaction,true);for(const amount of ['100.11','0','-1','1.001','NaN']){page.transaction.amount=amount;assert.equal(page.validTransaction,false);}
 page.transaction.amount='10';page.transaction.kind='transfer';page.transaction.toAccountId='a';assert.equal(page.validTransaction,false);page.transaction.toAccountId='b';assert.equal(page.validTransaction,true);page.accounts[1].currency='USD';assert.equal(page.validTransaction,false);page.accounts[1].currency='PHP';page.accounts[1].isArchived=true;assert.equal(page.validTransaction,false);
 page.transaction.kind='deposit';page.transaction.postedOn='2999-01-01';assert.equal(page.validTransaction,false);
});
test('account form allows zero opening balance and only last four digits',()=>{
 const {page}=setup();page.openAccount();page.draft.name='Operating';page.draft.bankName='Bank';assert.equal(page.validAccount,true);page.draft.lastFour='123';assert.equal(page.validAccount,false);page.draft.lastFour='1234';assert.equal(page.validAccount,true);page.draft.openingBalance='-1';assert.equal(page.validAccount,false);
});
test('failed writes retain retry key; double submit is blocked; success refreshes accounts',()=>{
 const {page,account,requests}=setup();page.openTransaction('deposit',account);page.transaction.amount='25.10';page.saveTransaction();page.saveTransaction();assert.equal(requests.length,1);const key=requests[0].body.requestKey;
 requests[0].stream.error({error:{message:'Try again'}});assert.equal(page.formError,'Try again');assert.equal(page.transaction.amount,'25.10');page.saveTransaction();assert.equal(requests[1].body.requestKey,key);requests[1].stream.next({});assert.equal(page.modal,null);assert.equal(page.saving,false);assert.equal(requests[2].method,'getFresh');
});
test('read-only users cannot add accounts, transact or reverse',()=>{
 const {page,account,requests,deps}=setup();deps.AuthService.hasPermission=p=>p==='banks.read';page.openAccount();page.openTransaction('deposit',account);page.openReversal({kind:'deposit'});assert.equal(page.modal,null);page.saveAccount();page.saveTransaction();page.reverse();assert.equal(requests.length,0);
});
test('switching organizations cancels writes and history and clears financial data',()=>{
 const {page,account,requests,effects}=setup();page.openHistory(account);page.openTransaction('deposit',account);page.transaction.amount='1';page.saveTransaction();effects[0]();assert.equal(requests[0].stream.observers.length,0);assert.equal(requests[1].stream.observers.length,0);assert.equal(page.selected,null);assert.equal(page.entries.length,0);assert.equal(page.accounts.length,0);assert.equal(page.modal,null);assert.equal(page.saving,false);
});
test('history filters are scoped and pagination independent of accounts',()=>{
 const {page,account,requests}=setup();page.openHistory(account);requests[0].stream.next({data:{account,entries:[]},meta:{total:26,totalPages:2}});page.loadHistory(1);assert.match(requests[1].url,/page=2/);page.kind='withdrawal';page.from='2026-01-01';page.filterHistory();assert.match(requests[2].url,/kind=withdrawal/);assert.match(requests[2].url,/organizationId=org-a/);assert.equal(page.page,1);page.ngOnDestroy();assert.equal(requests[2].stream.observers.length,0);
});
test('reversal requires a reason and preserves retry identity',()=>{
 const {page,requests}=setup();page.openReversal({kind:'deposit',operationId:'op'});page.reverse();assert.equal(requests.length,0);page.reason='Duplicate entry';page.reverse();assert.match(requests[0].url,/transactions\/op\/reverse/);assert.equal(requests[0].body.reason,'Duplicate entry');
});
test('search and archived filter show only matching accounts',()=>{
 const {page}=setup();page.accounts[1].isArchived=true;assert.equal(page.visibleAccounts.length,1);page.showArchived=true;assert.equal(page.visibleAccounts.length,2);page.search='Savings';assert.equal(page.visibleAccounts.length,1);assert.equal(page.visibleAccounts[0].id,'b');
});

test('CSV export quotes fields and neutralizes formula-like references and notes',async()=>{
 const {page,account,downloads}=setup();page.selected=account;page.entries=[{postedOn:'2026-01-01',kind:'deposit',direction:'credit',amount:'1.00',balanceAfter:'101.10',reference:'=SUM(1,2)',notes:'  +formula',createdAt:'2026-01-01'}];page.exportPage();assert.equal(downloads.length,1);const csv=await downloads[0].text();assert.match(csv, /"'=SUM\(1,2\)"/);assert.match(csv,/"'  \+formula"/);assert.match(csv,/Balance after posting/);
});

test('non-admins with all bank permissions cannot load, create, manage or export banks',()=>{
 const {page,account,requests,deps,downloads}=setup();deps.AuthService.isPrivileged=()=>false;deps.AuthService.hasPermission=()=>true;
 page.load();page.openHistory(account);page.openAccount();page.openTransaction('deposit',account);page.openReversal({kind:'deposit'});page.selected=account;page.loadHistory();page.exportPage();page.saveAccount();page.saveTransaction();page.reverse();
 assert.equal(page.canManage,false);assert.equal(page.canTransact,false);assert.equal(page.modal,null);assert.equal(requests.length,0);assert.equal(downloads.length,0);
});
