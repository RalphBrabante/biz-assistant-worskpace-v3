import {MoneyInputDirective} from '../../shared/money-input.directive';
import {RowActionsComponent} from '../../shared/row-actions.component';
import {CommonModule} from '@angular/common';
import {Component,OnDestroy,effect,inject} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Subscription} from 'rxjs';
import {ApiService} from '../../core/api.service';
import {AuthService} from '../../core/auth.service';
import {OrganizationContextService} from '../../core/organization-context.service';
import {ModalDirective} from '../../shared/modal.directive';
import {DropdownDirective} from '../../shared/dropdown.directive';
interface Account {id:string;name:string;bankName:string;lastFour:string;currency:string;balance:string;isArchived:boolean;notes:string;}
interface Entry {id:string;operationId:string;kind:string;direction:string;amount:string;balanceAfter:string;postedOn:string;reference:string;notes:string;createdAt:string;operation?:{author?:{firstName:string;lastName:string};reversal?:{id:string}};}
interface List {accounts:Account[];currency:string;totals:{currency:string;balance:string}[];}
interface History {account:Account;entries:Entry[];}
@Component({selector:'app-banks-page',standalone:true,imports: [MoneyInputDirective, RowActionsComponent, CommonModule,FormsModule,ModalDirective,DropdownDirective],templateUrl:'./banks-page.component.html',styleUrl:'./banks-page.component.css'})
export class BanksPageComponent implements OnDestroy {
  private api=inject(ApiService); readonly auth=inject(AuthService); readonly organizations=inject(OrganizationContextService);
  accounts:Account[]=[];totals:List['totals']=[];currency='PHP';search='';showArchived=false;
  loading=false;saving=false;error='';notice='';formError='';modal:'account'|'transaction'|'reversal'|null=null;
  selected:Account|null=null;entries:Entry[]=[];historyLoading=false;historyError='';page=1;pages=1;total=0;kind='';from='';to='';
  editing:Account|null=null;reversing:Entry|null=null;reason='';
  draft=this.newAccount();transaction=this.newTransaction();
  private requestKey=crypto.randomUUID();private listSub?:Subscription;private historySub?:Subscription;private writes=new Subscription();
  constructor(){effect(()=>{this.organizations.selectedOrganizationId();this.auth.currentUser();this.listSub?.unsubscribe();this.historySub?.unsubscribe();this.writes.unsubscribe();this.writes=new Subscription();this.accounts=[];this.totals=[];this.selected=null;this.entries=[];this.modal=null;this.loading=false;this.saving=false;this.historyLoading=false;this.error='';this.notice='';this.formError='';this.historyError='';this.search='';this.showArchived=false;this.page=1;this.kind='';this.from='';this.to='';if(this.organizations.getActiveOrganizationId())this.load();});}
  ngOnDestroy(){this.listSub?.unsubscribe();this.historySub?.unsubscribe();this.writes.unsubscribe();}
  get canManage(){return this.auth.isPrivileged() && this.auth.hasPermission('banks.manage');}get canTransact(){return this.auth.isPrivileged() && this.auth.hasPermission('banks.transact');}
  get visibleAccounts(){const q=this.search.trim().toLowerCase();return this.accounts.filter(a=>(this.showArchived||!a.isArchived)&&(!q||`${a.name} ${a.bankName} ${a.lastFour}`.toLowerCase().includes(q)));}
  get activeAccounts(){return this.accounts.filter(a=>!a.isArchived);}
  get sourceAccount(){return this.accounts.find(a=>a.id===this.transaction.accountId);}
  get destinations(){return this.activeAccounts.filter(a=>a.id!==this.transaction.accountId&&a.currency===this.sourceAccount?.currency);}
  today(){return new Date(Date.now()+8*3600000).toISOString().slice(0,10);}
  newAccount(){return {name:'',bankName:'',lastFour:'',openingBalance:'0.00',postedOn:this.today(),notes:'',isArchived:false};}
  newTransaction(){return {kind:'deposit',accountId:'',toAccountId:'',amount:'',postedOn:this.today(),reference:'',notes:''};}
  money(value:string,currency=this.currency){try{return new Intl.NumberFormat('en-PH',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));}catch{return `${currency} ${Number(value).toFixed(2)}`;}}
  private minor(value:string):bigint|null{if(!/^\d{1,12}(\.\d{1,2})?$/.test(String(value)))return null;const [whole,fraction='']=String(value).split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));}
  get validAccount(){return !!this.draft.name.trim()&&!!this.draft.bankName.trim()&&(!this.draft.lastFour||/^\d{4}$/.test(this.draft.lastFour))&&(!!this.editing||(this.minor(this.draft.openingBalance)!==null&&!!this.draft.postedOn&&this.draft.postedOn<=this.today()));}
  get validTransaction(){const n=this.minor(this.transaction.amount),source=this.sourceAccount;return !!source&&!source.isArchived&&n!==null&&n>0n&&!!this.transaction.postedOn&&this.transaction.postedOn<=this.today()&&(this.transaction.kind==='deposit'||n<= (this.minor(source.balance)||0n))&&(this.transaction.kind!=='transfer'||this.destinations.some(a=>a.id===this.transaction.toAccountId));}
  url(path='',params=new URLSearchParams()){params.set('organizationId',this.organizations.getActiveOrganizationId());return `/api/v1/banks${path}?${params}`;}
  load(){this.listSub?.unsubscribe();if(!this.auth.isPrivileged() || !this.organizations.getActiveOrganizationId())return;this.loading=true;this.error='';this.listSub=this.api.getFresh<List>(this.url()).subscribe({next:r=>{this.loading=false;this.accounts=r.data?.accounts||[];this.totals=r.data?.totals||[];this.currency=r.data?.currency||'PHP';if(this.selected){this.selected=this.accounts.find(a=>a.id===this.selected?.id)||null;if(this.selected)this.loadHistory();}},error:e=>{this.loading=false;this.error=e?.error?.message||'Unable to load bank accounts.';}});}
  openHistory(account:Account){if(!this.auth.isPrivileged())return;this.selected=account;this.page=1;this.kind='';this.from='';this.to='';this.entries=[];this.loadHistory();}
  filterHistory(){this.page=1;this.loadHistory();}
  loadHistory(delta=0){if(!this.auth.isPrivileged()||!this.selected||this.page+delta<1||this.page+delta>this.pages&&delta!==0)return;this.page+=delta;this.historySub?.unsubscribe();this.historyLoading=true;this.historyError='';const id=this.selected.id,params=new URLSearchParams({page:String(this.page)});if(this.kind)params.set('kind',this.kind);if(this.from)params.set('from',this.from);if(this.to)params.set('to',this.to);this.historySub=this.api.getFresh<History>(this.url(`/${id}/transactions`,params)).subscribe({next:r=>{this.historyLoading=false;if(this.selected?.id!==id||!r.data)return;this.selected=r.data.account;this.entries=r.data.entries;this.total=r.meta?.total||0;this.pages=Math.max(1,r.meta?.totalPages||1);},error:e=>{this.historyLoading=false;this.historyError=e?.error?.message||'Unable to load transactions.';}});}
  openAccount(account:Account|null=null){if(!this.canManage||this.saving)return;this.editing=account;this.draft=account?{...this.newAccount(),...account}:this.newAccount();this.formError='';this.requestKey=crypto.randomUUID();this.modal='account';}
  openTransaction(kind='deposit',account:Account|null=null){if(!this.canTransact||this.saving)return;this.transaction={...this.newTransaction(),kind,accountId:account?.id||this.activeAccounts[0]?.id||''};this.formError='';this.requestKey=crypto.randomUUID();this.modal='transaction';}
  openReversal(entry:Entry){if(!this.canTransact||this.saving||entry.operation?.reversal||['opening','reversal','cheque','cheque_return','voucher','voucher_void'].includes(entry.kind))return;this.reversing=entry;this.reason='';this.formError='';this.requestKey=crypto.randomUUID();this.modal='reversal';}
  close(){if(!this.saving)this.modal=null;}
  private success(message:string){this.saving=false;this.modal=null;this.notice=message;this.page=1;this.load();}
  private failure(error:any){this.saving=false;this.formError=error?.error?.message||'Unable to confirm this action. Retry the same form to avoid duplicates.';}
  saveAccount(){if(!this.canManage||this.saving||!this.validAccount)return;this.saving=true;this.formError='';const request=this.editing?this.api.put(this.url(`/${this.editing.id}`),{...this.draft}):this.api.create(this.url(),{...this.draft,requestKey:this.requestKey});this.writes.add(request.subscribe({next:()=>this.success(this.editing?'Bank account updated.':'Bank account added.'),error:e=>this.failure(e)}));}
  saveTransaction(){if(!this.canTransact||this.saving||!this.validTransaction)return;this.saving=true;this.formError='';this.writes.add(this.api.create(this.url('/transactions'),{...this.transaction,requestKey:this.requestKey}).subscribe({next:()=>this.success('Transaction recorded. Balances updated.'),error:e=>this.failure(e)}));}
  reverse(){if(!this.canTransact||this.saving||!this.reversing||!this.reason.trim())return;this.saving=true;this.formError='';this.writes.add(this.api.create(this.url(`/transactions/${this.reversing.operationId}/reverse`),{reason:this.reason,requestKey:this.requestKey}).subscribe({next:()=>this.success('Transaction reversed. Original history retained.'),error:e=>this.failure(e)}));}
  exportPage(){if(!this.auth.isPrivileged()||!this.selected||this.historyLoading||this.historyError)return;const cell=(value:unknown)=>{let s=String(value??'');if(/^(?:\s*[=+\-@]|[\t\r\n])/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=[['Date','Type','Direction','Amount','Currency','Balance after posting','Reference','Notes','Recorded by','Recorded at'],...this.entries.map(e=>[e.postedOn,e.kind,e.direction,e.amount,this.selected!.currency,e.balanceAfter,e.reference,e.notes,e.operation?.author?`${e.operation.author.firstName} ${e.operation.author.lastName}`:'Unavailable',e.createdAt])];const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`bank-transactions-page-${this.page}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
