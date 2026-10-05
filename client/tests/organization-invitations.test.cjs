const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),rx=require('rxjs');
function setup(role='administrator'){
 const requests=[],pending=new rx.Subject();
 const roles=[{id:'accountant-role',code:'accountant',name:'ACCOUNTANT'},{id:'enduser-role',code:'enduser',name:'STANDARD USER'}];
 const api={get:()=>rx.of({data:{id:'org-b'}}),list:url=>{requests.push({method:'GET',url});return rx.of({data:url.endsWith('/assignable-roles')?roles:[]});},create:(url,body)=>{requests.push({method:'POST',url,body});return pending;}};
 const dependencies={ApiService:api,AuthService:{isPrivileged:()=>['administrator','superuser'].includes(role)},ActivatedRoute:{snapshot:{paramMap:{get:()=> 'org-b'}}},ConfirmDialogService:{}};
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/organization-detail-page/organization-detail-page.component.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,require:name=>name==='@angular/core'?{Component:()=>value=>value,inject:key=>dependencies[key]}:new Proxy({},{get:(_,key)=>key})});
 const page=new module.exports.OrganizationDetailPageComponent();page.ngOnInit();return {page,requests,pending};
}
test('invitations send the selected organization role and names and clear completed inputs',()=>{
 const {page,requests,pending}=setup();assert.equal(page.selectedInviteRoleId,'accountant-role');page.selectedInviteRoleId='enduser-role';page.inviteEmail=' reviewer@example.test ';page.inviteFirstName=' Example ';page.inviteLastName=' Reviewer ';page.inviteUser();
 const request=requests.find(r=>r.method==='POST');assert.equal(request.url,'/api/v1/organizations/org-b/invitations');assert.equal(request.body.roleId,'enduser-role');assert.equal(request.body.email,'reviewer@example.test');assert.equal(request.body.firstName,'Example');assert.equal(page.invitingUser,true);
 pending.next({data:{inviteEmail:{sent:true}}});assert.equal(page.invitingUser,false);assert.equal(page.inviteEmail,'');assert.equal(page.selectedInviteRoleId,'enduser-role');assert.ok(page.message.includes('only to this organization'));
});
test('delivery failure preserves details for retry while refreshing the saved membership',()=>{
 const {page,requests,pending}=setup();page.inviteEmail='reviewer@example.test';page.inviteUser();pending.next({data:{inviteEmail:{sent:false,message:'Retry the invitation.'}}});assert.equal(page.inviteEmail,'reviewer@example.test');assert.equal(page.error,'Retry the invitation.');assert.equal(page.invitingUser,false);assert.equal(requests.filter(r=>r.url.endsWith('/users')).length,2);
});
test('only administrators and superusers load invitation choices; empty email does not submit',()=>{
 for(const role of ['administrator','superuser','accountant','enduser']){
  const {page,requests}=setup(role),allowed=['administrator','superuser'].includes(role);assert.equal(page.canManageMembers,allowed);assert.equal(requests.some(r=>r.url.endsWith('/assignable-roles')),allowed);page.inviteUser();assert.equal(requests.some(r=>r.method==='POST'),false);
 }
});
