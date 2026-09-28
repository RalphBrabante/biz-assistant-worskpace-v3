import {Directive,ElementRef,HostListener,Input,forwardRef} from '@angular/core';
import {AbstractControl,ControlValueAccessor,NG_VALIDATORS,NG_VALUE_ACCESSOR,ValidationErrors,Validator} from '@angular/forms';

/** A money-only accessor: preserve numeric models and exact decimal-string ledgers. */
@Directive({
 selector:'input[appMoney]',standalone:true,
 host:{'type':'text','inputmode':'decimal'},
 providers:[
  {provide:NG_VALUE_ACCESSOR,useExisting:forwardRef(()=>MoneyInputDirective),multi:true},
  {provide:NG_VALIDATORS,useExisting:forwardRef(()=>MoneyInputDirective),multi:true},
 ],
})
export class MoneyInputDirective implements ControlValueAccessor,Validator {
 @Input() moneyAsNumber=false;
 private last='';
 private change:(value:string|number|null)=>void=()=>{};
 private touched:()=>void=()=>{};
 constructor(private element:ElementRef<HTMLInputElement>){}
 writeValue(value:unknown):void {
  const raw=value===null||value===undefined?'':String(value);
  this.last=/^\d+(?:\.\d{1,2})?$/.test(raw)?this.fixed(raw):raw;
  this.element.nativeElement.value=this.last;
 }
 registerOnChange(fn:(value:string|number|null)=>void):void{this.change=fn;}
 registerOnTouched(fn:()=>void):void{this.touched=fn;}
 setDisabledState(disabled:boolean):void{this.element.nativeElement.disabled=disabled;}
 validate(control:AbstractControl):ValidationErrors|null {
  const value=control.value;
  return value===null||value===undefined||value===''||/^\d+(?:\.\d{1,2})?$/.test(String(value))?null:{moneyPrecision:true};
 }
 @HostListener('input') input():void {
  const field=this.element.nativeElement,raw=field.value;
  // Reject extra precision, signs, exponent notation and nonnumeric pasted text.
  // Keep the previous amount rather than silently rounding a financial entry.
  if(!/^\d*(?:\.\d{0,2})?$/.test(raw)){field.value=this.last;return;}
  this.last=raw;
  this.change(this.model(raw));
 }
 @HostListener('blur') blur():void {
  const raw=this.last;
  if(raw===''||raw==='.'){this.last='';}
  else if(/^\d*(?:\.\d{0,2})?$/.test(raw)){this.last=this.fixed(raw);}
  this.element.nativeElement.value=this.last;
  // Numeric controls retain their type; string ledgers receive fixed decimals.
  if(this.model(raw)!==this.model(this.last))this.change(this.model(this.last));
  this.touched();
 }
 private model(raw:string):string|number|null {
  if(raw===''||raw==='.')return this.moneyAsNumber?null:'';
  const normalized=raw.startsWith('.')?'0'+raw:raw;
  return this.moneyAsNumber?Number(normalized):normalized.endsWith('.')?normalized.slice(0,-1):normalized;
 }
 private fixed(raw:string):string {
  const [whole,fraction='']=raw.split('.');
  return `${(whole||'0').replace(/^0+(?=\d)/,'')}.${fraction.padEnd(2,'0')}`;
 }
}
