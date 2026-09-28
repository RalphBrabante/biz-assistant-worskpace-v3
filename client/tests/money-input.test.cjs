const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
function setup(numeric=false){
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/shared/money-input.directive.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText;
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:()=>({Directive:()=>v=>v,HostListener:()=>()=>{},Input:()=>()=>{},forwardRef:f=>f})});
 const field={value:'',disabled:false},values=[];let touched=0;const control=new module.exports.MoneyInputDirective({nativeElement:field});control.moneyAsNumber=numeric;control.registerOnChange(v=>values.push(v));control.registerOnTouched(()=>touched++);
 const enter=value=>{field.value=value;control.input();};return {control,field,values,enter,touched:()=>touched};
}
test('loaded and blurred amounts show exactly two places without converting blanks to zero',()=>{const{control,field}=setup();for(const [input,expected] of [[25,'25.00'],['25.1','25.10'],[0,'0.00'],[null,''],['',''],['001.20','1.20']]){control.writeValue(input);assert.equal(field.value,expected);}});
test('decimal-string ledgers preserve exact cents and normalize on blur',()=>{const{control,field,values,enter,touched}=setup();enter('999999999999.99');control.blur();assert.equal(values.at(-1),'999999999999.99');enter('25.1');control.blur();assert.equal(field.value,'25.10');assert.equal(values.at(-1),'25.10');assert.equal(touched(),2);});
test('numeric models stay numeric and formatting does not retrigger calculations',()=>{const{control,field,values,enter}=setup(true);enter('25.1');assert.equal(values.at(-1),25.1);control.blur();assert.equal(field.value,'25.10');assert.equal(values.length,1);enter('');assert.equal(values.at(-1),null);});
test('extra decimals, exponent notation, signs and invalid paste do not replace the amount',()=>{const{control,field,values,enter}=setup();control.writeValue('12.34');for(const bad of ['12.345','1e3','-1','+1','abc','1,2','1.2.3']){enter(bad);assert.equal(field.value,'12.34');}assert.equal(values.length,0);});
test('editing supports leading decimals and trailing decimal points',()=>{const{control,field,values,enter}=setup();enter('.5');assert.equal(values.at(-1),'0.5');control.blur();assert.equal(field.value,'0.50');enter('12.');assert.equal(values.at(-1),'12');control.blur();assert.equal(field.value,'12.00');enter('.');control.blur();assert.equal(field.value,'');assert.equal(values.at(-1),'');});
test('programmatic precision errors are validated instead of silently rounded',()=>{const{control,field}=setup();control.writeValue('1.234');assert.equal(field.value,'1.234');assert.equal(control.validate({value:'1.234'}).moneyPrecision,true);for(const value of [0,1.25,'12.00',null,''])assert.equal(control.validate({value}),null);});
test('form resets and disabled-state changes propagate to the input',()=>{const{control,field}=setup();control.writeValue('2');control.setDisabledState(true);assert.equal(field.disabled,true);control.writeValue(null);assert.equal(field.value,'');control.setDisabledState(false);assert.equal(field.disabled,false);});
test('amount inputs use the shared formatter while quantities, counts and rates retain their controls',()=>{
 const root=path.join(__dirname,'../src/app');let covered=0;
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.html')){
 const html=fs.readFileSync(file,'utf8'),inputs=html.match(/<input\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)||[];
 for(const input of inputs){if(input.includes('appMoney'))covered++;
 const amount=input.includes('inputmode="decimal"')||(input.includes('step="0.01"')&&!/percentage|incomeTaxRate/.test(input))||input.includes('formControlName="creditLimit"');
 if(amount)assert(input.includes('appMoney'),file+': missing money formatter');
 if(/formControlName="(?:stock|reorderLevel|paymentTermsDays|employeeCount|maxUsers|percentage|incomeTaxRate)"|ngModel\)\]="line.quantity"/.test(input))assert(!input.includes('appMoney'),file+': non-money control changed');
 }
 }}}
 walk(root);assert.equal(covered,34);
});
