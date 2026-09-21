const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function environment() {
 const document = { activeElement: null, body: { style: { overflow: 'auto' } } };
 class Element {
  constructor() { this.attributes={};this.style={};this.children=[];this.isConnected=true;this.rect={left:350,right:380,top:750,bottom:780,width:30,height:30};this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)}; }
  setAttribute(k,v){this.attributes[k]=v;} getAttribute(k){return this.attributes[k]??null;} hasAttribute(k){return k in this.attributes;} removeAttribute(k){delete this.attributes[k];}
  contains(item){return item===this||this.children.includes(item);} focus(){document.activeElement=this;} click(){this.clicked=true;}
  querySelector(selector){return selector==='.ui-dropdown-menu'?this.menu:selector.includes('modal-title')?this.title:this.close;}
  querySelectorAll(){return this.children;} getClientRects(){return [this.rect];} getBoundingClientRect(){return this.rect;}
  remove(){this.removed=true;}
 }
 document.createElement=()=>new Element();document.body.appendChild=()=>{};
 const cache=new Map();
 function load(name) {
  if(cache.has(name))return cache.get(name);
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/shared', name+'.directive.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:()=>({Directive:()=>v=>v,HostListener:()=>()=>{}}),document,window:{innerWidth:390,innerHeight:844},queueMicrotask:fn=>fn()});
  cache.set(name,module.exports);return module.exports;
 }
 return {Element,document,load};
}
function dropdown(env){const {Element,load}=env;const trigger=new Element(),parent=new Element(),menu=new Element();trigger.parentElement=parent;parent.menu=menu;menu.rect={width:180,height:220};menu.children=[new Element(),new Element()];const instance=new (load('dropdown').DropdownDirective)({nativeElement:trigger});return {trigger,menu,instance};}
function key(key){return {key,preventDefault(){this.prevented=true;}};}

test('dropdown opens upward near viewport bottom and stays inside narrow screens',()=>{
 const e=environment(),d=dropdown(e);d.instance.toggle({stopPropagation(){}});
 assert.equal(d.trigger.getAttribute('aria-expanded'),'true');assert.equal(d.menu.style.position,'fixed');assert.equal(d.menu.style.left,'200px');assert.equal(d.menu.style.top,'524px');
});
test('only one row menu stays open; outside clicks dismiss it',()=>{
 const e=environment(),a=dropdown(e),b=dropdown(e);a.instance.toggle({stopPropagation(){}});b.instance.toggle({stopPropagation(){}});
 assert.equal(a.trigger.getAttribute('aria-expanded'),'false');assert.equal(b.trigger.getAttribute('aria-expanded'),'true');b.instance.outside({target:new e.Element()});assert.equal(b.trigger.getAttribute('aria-expanded'),'false');
});
test('dropdown arrow keys move focus and Escape returns to its trigger',()=>{
 const e=environment(),d=dropdown(e);d.trigger.focus();d.instance.keyboard(key('ArrowDown'));assert.equal(e.document.activeElement,d.menu.children[0]);d.instance.keyboard(key('ArrowDown'));assert.equal(e.document.activeElement,d.menu.children[1]);d.instance.keyboard(key('Escape'));assert.equal(e.document.activeElement,d.trigger);assert.equal(d.trigger.getAttribute('aria-expanded'),'false');
});
test('ArrowUp on a closed dropdown focuses its last action',()=>{
 const e=environment(),d=dropdown(e);d.trigger.focus();d.instance.keyboard(key('ArrowUp'));assert.equal(e.document.activeElement,d.menu.children[1]);
});
test('modal traps Tab and restores the previous focus and scroll state',()=>{
 const e=environment(),host=new e.Element(),previous=new e.Element();host.children=[new e.Element(),new e.Element()];previous.focus();const modal=new (e.load('modal').ModalDirective)({nativeElement:host});modal.ngAfterViewInit();assert.equal(e.document.body.style.overflow,'hidden');assert.equal(e.document.activeElement,host.children[0]);
 host.children[1].focus();modal.keydown(key('Tab'));assert.equal(e.document.activeElement,host.children[0]);const back=key('Tab');back.shiftKey=true;modal.keydown(back);assert.equal(e.document.activeElement,host.children[1]);modal.ngOnDestroy();assert.equal(e.document.activeElement,previous);assert.equal(e.document.body.style.overflow,'auto');
});
test('stacked dialogs keep scrolling locked until the last dialog closes',()=>{
 const e=environment(),Modal=e.load('modal').ModalDirective,a=new e.Element(),b=new e.Element();a.close=new e.Element();b.close=new e.Element();const first=new Modal({nativeElement:a}),second=new Modal({nativeElement:b});first.ngAfterViewInit();second.ngAfterViewInit();first.keydown(key('Escape'));assert.equal(a.close.clicked,undefined);second.keydown(key('Escape'));assert.equal(b.close.clicked,true);second.ngOnDestroy();assert.equal(e.document.body.style.overflow,'hidden');first.ngOnDestroy();assert.equal(e.document.body.style.overflow,'auto');
});
test('tooltip uses plain text and restores the original accessible description',()=>{
 const e=environment(),host=new e.Element();host.setAttribute('title','<b>Help</b>');host.setAttribute('aria-describedby','hint');const tooltip=new (e.load('tooltip').TooltipDirective)({nativeElement:host});tooltip.show();assert.equal(tooltip.tooltip.textContent,'<b>Help</b>');assert.match(host.getAttribute('aria-describedby'),/^hint app-tooltip-/);tooltip.hide();assert.equal(host.getAttribute('title'),'<b>Help</b>');assert.equal(host.getAttribute('aria-describedby'),'hint');
});
