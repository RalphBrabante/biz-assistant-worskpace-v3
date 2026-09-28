import {MoneyInputDirective} from '../../shared/money-input.directive';
import {CommonModule} from '@angular/common';
import {Component,OnDestroy,effect,inject} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {Subscription} from 'rxjs';
import {ApiService} from '../../core/api.service';
import {AuthService} from '../../core/auth.service';
import {OrganizationContextService} from '../../core/organization-context.service';
import {ModalDirective} from '../../shared/modal.directive';
import {RowActionsComponent} from '../../shared/row-actions.component';
interface Account{id:string;name:string;bankName:string;currency:string;balance:string;isArchived:boolean;}
interface Cheque{id:string;accountId:string;number:string;payee:string;amount:string;currency:string;issuedOn:string;datedOn:string;status:string;reference:string;notes:string;clearedOn:string;returnedOn:string;account?:Account;history:{action:string;at:string;postedOn?:string;reason?:string}[];}
interface Listing{cheques:Cheque[];totals:{currency:string;outstanding:string;due:string}[];}
@Component({selector:'app-cheques',standalone:true,imports: [MoneyInputDirective, CommonModule,FormsModule,RouterLink,ModalDirective,RowActionsComponent],templateUrl:'./cheques-page.component.html'})
export class ChequesPageComponent implements OnDestroy{
 readonly auth=inject(AuthService);readonly organizations=inject(OrganizationContextService);private api=inject(ApiService);
 rows:Cheque[]=[];accounts:Account[]=[];totals:Listing['totals']=[];selected:Cheque|null=null;
 search='';status='';accountId='';due=false;page=1;pages=1;total=0;loading=false;saving=false;error='';notice='';formError='';
 modal:''|'issue'|'clear'|'void'|'return'='';draft=this.newDraft();postedOn=this.today();reason='';
 private key=crypto.randomUUID();private reads=new Subscription();private writes=new Subscription();
 constructor(){effect(()=>{this.organizations.selectedOrganizationId();this.auth.currentUser();this.reads.unsubscribe();this.writes.unsubscribe();this.reads=new Subscription();this.writes=new Subscription();this.rows=[];this.accounts=[];this.totals=[];this.selected=null;this.modal='';this.saving=false;this.loading=false;this.error='';this.notice='';this.search='';this.status='';this.accountId='';this.due=false;this.page=1;if(this.canManage&&this.organizations.getActiveOrganizationId())this.load();});}
 ngOnDestroy(){this.reads.unsubscribe();this.writes.unsubscribe();}
 get canManage(){return this.auth.isPrivileged()&&this.auth.hasPermission('banks.transact');}
 get activeAccounts(){return this.accounts.filter(a=>!a.isArchived);}
 today(){return new Date(Date.now()+8*3600000).toISOString().slice(0,10);}
 newDraft(){return {accountId:'',number:'',payee:'',amount:'',issuedOn:this.today(),datedOn:this.today(),reference:'',notes:''};}
 money(value:string,currency:string){return new Intl.NumberFormat('en-PH',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));}
 private url(path=''){return `/api/v1/cheques${path}?organizationId=${encodeURIComponent(this.organizations.getActiveOrganizationId())}`;}
 get valid(){const d=this.draft;return !!d.number.trim()&&!!d.payee.trim()&&this.activeAccounts.some(a=>a.id===d.accountId)&&/^\d{1,12}(\.\d{1,2})?$/.test(d.amount)&&Number(d.amount)>0&&!!d.issuedOn&&d.issuedOn<=this.today()&&!!d.datedOn&&d.datedOn>=d.issuedOn;}
 get validAction(){return this.modal==='void'?!!this.reason.trim():!!this.postedOn&&this.postedOn<=this.today()&&this.postedOn>=(this.modal==='return'?this.selected?.clearedOn||'':this.selected?.datedOn||'')&&(this.modal!=='return'||!!this.reason.trim());}
 load(page=this.page){if(!this.canManage||!this.organizations.getActiveOrganizationId())return;this.reads.unsubscribe();this.reads=new Subscription();this.page=page;this.loading=true;this.error='';
  const params=new URLSearchParams({page:String(page),q:this.search,status:this.status,accountId:this.accountId,due:String(this.due)});
  this.reads.add(this.api.getFresh<Listing>(this.url()+'&'+params).subscribe({next:r=>{this.rows=r.data?.cheques||[];this.totals=r.data?.totals||[];this.total=r.meta?.total||0;this.pages=Math.max(1,r.meta?.totalPages||1);this.loading=false;if(this.selected)this.selected=this.rows.find(c=>c.id===this.selected?.id)||null;},error:e=>{this.loading=false;this.error=e?.error?.message||'Unable to load cheques.';}}));
  this.reads.add(this.api.getFresh<{accounts:Account[]}>(`/api/v1/banks?organizationId=${encodeURIComponent(this.organizations.getActiveOrganizationId())}`).subscribe({next:r=>this.accounts=r.data?.accounts||[],error:e=>this.error=e?.error?.message||'Unable to load banks.'}));
 }
 openIssue(){if(!this.canManage||this.saving)return;this.draft={...this.newDraft(),accountId:this.activeAccounts[0]?.id||''};this.key=crypto.randomUUID();this.formError='';this.modal='issue';}
 open(action:'clear'|'void'|'return',row:Cheque){if(!this.canManage||this.saving||row.status!==(action==='return'?'cleared':'issued')||(action==='clear'&&row.datedOn>this.today()))return;this.selected=row;this.postedOn=this.today();this.reason='';this.formError='';this.modal=action;}
 close(){if(!this.saving)this.modal='';}
 save(){if(!this.canManage||this.saving||!this.organizations.getActiveOrganizationId()||(this.modal==='issue'?!this.valid:!this.selected||!this.validAction)||!this.modal)return;this.saving=true;this.formError='';
  const request=this.modal==='issue'?this.api.create(this.url(),{...this.draft,requestKey:this.key}):this.api.create(this.url(`/${this.selected!.id}/actions`),{action:this.modal,postedOn:this.postedOn,reason:this.reason});
  this.writes.add(request.subscribe({next:r=>{this.saving=false;this.modal='';this.notice=r.message||'Cheque updated.';this.load();},error:e=>{this.saving=false;this.formError=e?.error?.message||'Unable to save. Retry the same form safely.';}}));
 }
}
