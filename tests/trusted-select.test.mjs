import test from "node:test";
import assert from "node:assert/strict";
import {selectTrustedAgentOption} from "../chrome-agent-native/trusted-select.mjs";
function setup({label="Choose domain",disabled=false,multiple=false,options=[
  {value:"",textContent:"Choose domain",disabled:false},
  {value:"alpentcm.ch",textContent:"alpentcm.ch",disabled:false},
  {value:"other.ch",textContent:"other.ch",disabled:false}
]}={}) {
  globalThis.location={origin:"https://www.one.com"};
  const events=[];
  class Select {}
  Object.defineProperty(Select.prototype,"value",{get(){return this._value||"";},
    set(v){this._value=v;this.selectedIndex=this.options.findIndex(x=>x.value===v);}});
  globalThis.HTMLSelectElement=Select;
  globalThis.Event=class{constructor(type,{bubbles}={}){this.type=type;this.bubbles=bubbles;}};
  const select=new Select();
  Object.assign(select,{tagName:"SELECT",disabled,multiple,options,selectedIndex:0,
    getAttribute:(key)=>({"aria-label":label,autocomplete:""}[key]||null),
    closest:()=>null,dispatchEvent:e=>{events.push(e.type);return true;}});
  globalThis.document={querySelector:(q)=>q.includes("owl-agent-7")?select:null,
    querySelectorAll:()=>[]};
  return {select,events};
}
test("select exact user-approved domain without submitting",()=>{
  const {select,events}=setup();
  const r=selectTrustedAgentOption("owl-agent-7","alpentcm.ch","https://www.one.com");
  assert.equal(r.selected,true);assert.equal(r.domVerified,true);
  assert.equal(r.websitePersisted,false);assert.equal(select.selectedIndex,1);
  assert.deepEqual(events,["input","change"]);
});
test("accept exact visible option text even when internal value is opaque",()=>{
  const {select}=setup({options:[{value:"",textContent:"Choose domain"},{value:"opaque-5",textContent:"alpentcm.ch"}]});
  const r=selectTrustedAgentOption("owl-agent-7","alpentcm.ch","https://www.one.com");
  assert.equal(r.selected,true);assert.equal(select.value,"opaque-5");
});
test("reject option missing, disabled or ambiguous",()=>{
  setup();
  assert.equal(selectTrustedAgentOption("owl-agent-7","missing.ch","https://www.one.com").error,
     "SELECT_OPTION_NOT_UNIQUE_OR_AVAILABLE");
  setup({options:[{value:"one",textContent:"alpentcm.ch",disabled:true}]});
  assert.equal(selectTrustedAgentOption("owl-agent-7","alpentcm.ch","https://www.one.com").error,
     "SELECT_OPTION_NOT_UNIQUE_OR_AVAILABLE");
  setup({options:[{value:"one",textContent:"alpentcm.ch"}, {value:"two",textContent:"alpentcm.ch"}]});
  assert.equal(selectTrustedAgentOption("owl-agent-7","alpentcm.ch","https://www.one.com").error,
     "SELECT_OPTION_NOT_UNIQUE_OR_AVAILABLE");
});
test("refuse sensitive and disabled controls",()=>{
  setup({label:"Payment method"});
  assert.equal(selectTrustedAgentOption("owl-agent-7","alpentcm.ch","https://www.one.com").error,
    "SELECT_SENSITIVE_OR_DISABLED");
  setup({disabled:true});
  assert.equal(selectTrustedAgentOption("owl-agent-7","alpentcm.ch","https://www.one.com").error,
    "SELECT_SENSITIVE_OR_DISABLED");
});
test("reject wrong origin and stale uid",()=>{
  setup();
  assert.equal(selectTrustedAgentOption("owl-agent-7","alpentcm.ch","https://evil.example").error,
    "SELECT_ORIGIN_MISMATCH");
  assert.equal(selectTrustedAgentOption("owl-agent-8","alpentcm.ch","https://www.one.com").error,
    "SELECT_TARGET_INVALID");
});
