import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTrustedTextField,locateTrustedTextActivation} from '../chrome-agent-native/trusted-text-field.mjs';

function setup(tag='DIV', attributes={}, overrides={}){
  const attrs=new Map(Object.entries(attributes));
  const el={
    tagName:tag,
    isContentEditable:false,disabled:false,readOnly:false,
    getAttribute(k){return attrs.has(k)?attrs.get(k):null;},
    hasAttribute(k){return attrs.has(k);},
    setAttribute(k,v){attrs.set(k,v);},
    matches(){return false;},
    closest(){return null;},
    querySelectorAll(){return [];},
    getBoundingClientRect(){return {left:20,top:10,right:220,bottom:45,width:200,height:35};},
    contains(other){return other===this;},
    getRootNode(){return globalThis.document;},
    focus(){globalThis.document.activeElement=this;},
    ...overrides
  };
  globalThis.location={origin:'https://example.test'};
  globalThis.CSS={escape:s=>s};
  globalThis.innerWidth=1024;globalThis.innerHeight=768;
  globalThis.getComputedStyle=()=>({display:'block',visibility:'visible',pointerEvents:'auto'});
  globalThis.document={
    querySelector:()=>el,querySelectorAll:()=>[],
    elementFromPoint:()=>el,activeElement:null
  };
  return el;
}
const prep=()=>prepareTrustedTextField('owl-agent-1','https://example.test');
const locate=()=>locateTrustedTextActivation('owl-agent-1','https://example.test');

test('onclick-driven role=textbox can be activated safely',()=>{
  setup('DIV',{role:'textbox',onclick:'edit()','aria-label':'Add keywords'});
  assert.equal(prep().activationRequired,true);
  assert.equal(prep().reason,'LAZY_TEXT_CONTROL');
  assert.equal(locate().valid,true);
});

test('aria-placeholder-only widget is discoverable as lazy text target',()=>{
  setup('DIV',{'aria-placeholder':'Enter values',onclick:'activate()'});
  assert.equal(prep().activationRequired,true);
  assert.equal(locate().valid,true);
});

test('custom element with text semantics can activate',()=>{
  setup('ADS-TEXT-CHIPS',{role:'textbox','aria-label':'Negative keywords'});
  assert.equal(prep().activationRequired,true);
  assert.equal(locate().valid,true);
});

test('sensitive semantic widget must be rejected BEFORE activation',()=>{
  setup('DIV',{role:'textbox','aria-label':'One time verification code',onclick:'activate()'});
  assert.equal(prep().error,'SENSITIVE_OR_INVALID_FIELD');
  assert.equal(locate().error,'SENSITIVE_OR_INVALID_FIELD');
});

test('read-only and disabled widgets must not activate',()=>{
  setup('DIV',{role:'textbox','aria-readonly':'true'});
  assert.equal(prep().error,'TEXT_TARGET_NOT_EDITABLE');
  assert.equal(locate().error,'TEXT_ACTIVATION_DISALLOWED');
  setup('DIV',{role:'textbox','aria-disabled':'true'});
  assert.equal(prep().error,'TEXT_TARGET_NOT_EDITABLE');
  assert.equal(locate().error,'TEXT_ACTIVATION_DISALLOWED');
});

test('generic clickable wrapper is NOT treated as editor',()=>{
  setup('DIV',{onclick:'purchase()','aria-label':'Buy now'});
  assert.equal(prep().error,'TEXT_TARGET_NOT_EDITABLE');
  assert.equal(locate().error,'TEXT_ACTIVATION_NOT_SEMANTIC');
});

test('button with text semantics is not eligible for activation',()=>{
  setup('BUTTON',{role:'textbox',onclick:'submit()'});
  assert.equal(prep().error,'TEXT_TARGET_NOT_EDITABLE');
  assert.equal(locate().error,'TEXT_ACTIVATION_DISALLOWED');
});

test('native input selection is still prepared without activation',()=>{
  const el=setup('INPUT',{type:'text','aria-label':'Search'},{value:'old',selectionStart:-1,selectionEnd:-1,
    setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}});
  const res=prep();
  assert.equal(res.ready,true);
  assert.equal(res.kind,'native');
  assert.equal(res.nested,false);
  assert.equal(el.selectionEnd,3);
});

test('nonstandard type=string is accepted only when the browser normalizes it to text',()=>{
  const el=setup('INPUT',{type:'string','aria-label':'Add negative keyword'},
    {type:'text',value:'',selectionStart:-1,selectionEnd:-1,
      setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}});
  const result=prep();
  assert.equal(result.ready,true);
  assert.equal(result.kind,'native');
  assert.equal(el.selectionStart,0);
});

test('sensitive browser-normalized input types remain excluded',()=>{
  setup('INPUT',{type:'password','aria-label':'Password'},
    {type:'password',value:'',selectionStart:0,selectionEnd:0,
      setSelectionRange(){throw Error('should never select password');}});
  assert.equal(prep().error,'TEXT_TARGET_NOT_EDITABLE');
});

test('origin mismatch refuses all DOM interaction',()=>{
  setup('DIV',{role:'textbox'});
  assert.equal(prepareTrustedTextField('owl-agent-1','https://wrong.test').error,'TEXT_ORIGIN_CHANGED');
  assert.equal(locateTrustedTextActivation('owl-agent-1','https://wrong.test').error,'TEXT_ORIGIN_CHANGED');
});