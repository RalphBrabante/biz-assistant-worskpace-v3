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
interface Account{id:string;name:string;currency:string;balance:string;isArchived:boolean;}
interface Voucher{id:string;number:string;payee:string;description:string;category:string;amount:string;currency:string;accountId:string;account?:Account;postedOn:string;reference:string;notes:string;status:string;voidedOn:string;voidReason:string;history:{action:string;at:string;reason?:string}[];}
@Component({selector:'app-vouchers',standalone:true,imports: [MoneyInputDirective, CommonModule,FormsModule,RouterLink,ModalDirective,RowActionsComponent],templateUrl:'./vouchers-page.component.html'})
export class VouchersPageComponent implements OnDestroy{
 readonly auth=inject(AuthService);readonly organizations=inject(OrganizationContextService);private api=inject(ApiService);
 rows:Voucher[]=[];accounts:Account[]=[];selected:Voucher|null=null;search='';status='';accountId='';from='';to='';page=1;pages=1;total=0;loading=false;saving=false;error='';notice='';formError='';
 modal:''|'create'|'void'='';draft=this.newDraft();reason='';voidedOn=this.today();private key=crypto.randomUUID();private reads=new Subscription();private writes=new Subscription();
 constructor(){effect(()=>{this.organizations.selectedOrganizationId();this.auth.currentUser();this.reads.unsubscribe();this.writes.unsubscribe();this.reads=new Subscription();this.writes=new Subscription();this.rows=[];this.accounts=[];this.selected=null;this.modal='';this.saving=false;this.loading=false;this.error='';this.notice='';this.search='';this.status='';this.accountId='';this.from='';this.to='';this.page=1;if(this.canManage&&this.organizations.getActiveOrganizationId())this.load();});}
 ngOnDestroy(){this.reads.unsubscribe();this.writes.unsubscribe();}
 get canManage(){return this.auth.isPrivileged()&&this.auth.hasPermission('banks.transact');}
 get activeAccounts(){return this.accounts.filter(a=>!a.isArchived);}
 get source(){return this.activeAccounts.find(a=>a.id===this.draft.accountId);}
 today(){return new Date(Date.now()+8*3600000).toISOString().slice(0,10);}
 newDraft(){return {accountId:'',number:`PV-${this.today().replace(/-/g,'')}-${crypto.randomUUID().slice(0,8).toUpperCase()}`,payee:'',description:'',category:'',amount:'',postedOn:this.today(),reference:'',notes:''};}
 money(value:string,currency:string){return new Intl.NumberFormat('en-PH',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));}
 private minor(value:string){if(!/^\d{1,12}(\.\d{1,2})?$/.test(String(value)))return null;const [whole,fraction='']=String(value).split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));}
 get valid(){const d=this.draft,n=this.minor(d.amount);return !!this.source&&!!d.number.trim()&&!!d.payee.trim()&&!!d.description.trim()&&n!==null&&n>0n&&n<=(this.minor(this.source.balance)||0n)&&!!d.postedOn&&d.postedOn<=this.today();}
 get validVoid(){return !!this.selected&&this.selected.status==='posted'&&!!this.reason.trim()&&!!this.voidedOn&&this.voidedOn>=this.selected.postedOn&&this.voidedOn<=this.today();}
 private url(path=''){return `/api/v1/vouchers${path}?organizationId=${encodeURIComponent(this.organizations.getActiveOrganizationId())}`;}
 load(page=this.page){if(!this.canManage||!this.organizations.getActiveOrganizationId())return;this.reads.unsubscribe();this.reads=new Subscription();this.page=page;this.loading=true;this.error='';const params=new URLSearchParams({page:String(page),q:this.search,status:this.status,accountId:this.accountId,from:this.from,to:this.to});
  this.reads.add(this.api.getFresh<Voucher[]>(this.url()+'&'+params).subscribe({next:r=>{this.rows=r.data||[];this.total=r.meta?.total||0;this.pages=Math.max(1,r.meta?.totalPages||1);this.loading=false;if(this.selected)this.selected=this.rows.find(v=>v.id===this.selected?.id)||null;},error:e=>{this.loading=false;this.error=e?.error?.message||'Unable to load vouchers.';}}));
  this.reads.add(this.api.getFresh<{accounts:Account[]}>(`/api/v1/banks?organizationId=${encodeURIComponent(this.organizations.getActiveOrganizationId())}`).subscribe({next:r=>this.accounts=r.data?.accounts||[],error:e=>this.error=e?.error?.message||'Unable to load bank accounts.'}));
 }
 openCreate(){if(!this.canManage||this.saving)return;this.draft={...this.newDraft(),accountId:this.activeAccounts[0]?.id||''};this.key=crypto.randomUUID();this.formError='';this.modal='create';}
 openVoid(row:Voucher){if(!this.canManage||this.saving||row.status!=='posted')return;this.selected=row;this.reason='';this.voidedOn=this.today();this.formError='';this.modal='void';}
 close(){if(!this.saving)this.modal='';}
 save(){if(!this.canManage||this.saving||!this.organizations.getActiveOrganizationId()||!this.modal||(this.modal==='create'?!this.valid:!this.validVoid))return;this.saving=true;this.formError='';const request=this.modal==='create'?this.api.create(this.url(),{...this.draft,requestKey:this.key}):this.api.create(this.url(`/${this.selected!.id}/void`),{reason:this.reason,postedOn:this.voidedOn});this.writes.add(request.subscribe({next:r=>{this.saving=false;this.modal='';this.notice=r.message||'Voucher saved.';this.load(1);},error:e=>{this.saving=false;this.formError=e?.error?.message||'Unable to save. Retry the same form to avoid duplicates.';}}));}
}
