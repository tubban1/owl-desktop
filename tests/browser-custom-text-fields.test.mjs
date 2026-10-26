import {afterEach,describe,it,expect,vi} from "vitest";
import {createNativeAgentExecutor} from "../chrome-agent-native/agent-executor.mjs";
import {prepareTrustedTextField,checkTrustedTextField} from "../chrome-agent-native/trusted-text-field.mjs";

const origin="https://ads.google.com",url=origin+"/aw/express/campaigns/18391919022";
function field({tag="INPUT",role=null,contenteditable=false,type="text",label="Negative keyword themes",value="old"}={}){
  const attrs=new Map([["aria-label",label],["type",type]]);
  if(role)attrs.set("role",role);
  const el={
    tagName:tag,isContentEditable:contenteditable,disabled:false,readOnly:false,value,
    textContent:value,selectionStart:0,selectionEnd:0,
    getAttribute:k=>attrs.has(k)?attrs.get(k):null,
    closest:()=>null,querySelector:()=>null,querySelectorAll:()=>[],
    getBoundingClientRect:()=>({width:120,height:30}),
    focus(){globalThis.document.activeElement=el},
    getRootNode(){return globalThis.document},
    setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b}
  };
  return el;
}
function mount(el){
  const doc={
    querySelector:s=>s.includes("owl-agent-5")?el:null,
    querySelectorAll:()=>[],
    activeElement:null,
    createRange:()=>({selectNodeContents:()=>{}}),
    getSelection:()=>({rangeCount:1,removeAllRanges:()=>{},addRange:()=>{}})
  };
  vi.stubGlobal("document",doc);
  vi.stubGlobal("location",{origin});
  vi.stubGlobal("CSS",{escape:v=>v});
  vi.stubGlobal("getComputedStyle",()=>({display:"block",visibility:"visible"}));
  return doc;
}
afterEach(()=>vi.unstubAllGlobals());

function harness(){
  const state={};const calls=[];
  const chrome={
    storage:{session:{get:async k=>({[k]:state[k]}),set:async obj=>Object.assign(state,obj)}},
    tabs:{query:async()=>[],create:async({url})=>({id:50,url,active:false}),
      get:async()=>({id:50,url,active:false})},
    scripting:{executeScript:async({func,args})=>{
      calls.push(["inject",func.name,args]);
      if(func===prepareTrustedTextField)return [{result:{ready:true,uid:args[0],origin:args[1],kind:"native"}}];
      if(func===checkTrustedTextField)return [{result:{domVerified:true,websitePersisted:false}}];
      return [{result:{title:"Google Ads",url,text:"Campaign",controls:[]}}];
    }},
    debugger:{
      attach:async()=>{calls.push(["attach"])},
      detach:async()=>{calls.push(["detach"])},
      sendCommand:async(_target,method,args)=>{calls.push(["debugger",method,args])}
    }
  };
  return {agent:createNativeAgentExecutor(chrome,chrome.storage.session),calls};
}

describe("Agent Browser custom text fields in owner-isolated Chrome",()=>{
  it("fills a framework input using trusted Chromium input and no OS keyboard",async()=>{
    const {agent,calls}=harness();
    await agent.run({owner:"user-session",op:"open",args:{url}});
    const res=await agent.run({owner:"user-session",op:"fill",
      args:{uid:"owl-agent-5",value:"physiotherapie"}});
    expect(res).toMatchObject({filled:true,domVerified:true,websitePersisted:false,
      foregroundUnchanged:true,systemKeyboardUsed:false,
      inputMethod:"tab_scoped_chromium_trusted_text"});
    expect(calls.map(x=>x[0])).toEqual(["inject","attach","debugger","detach","inject"]);
    expect(calls.find(x=>x[1]==="Input.insertText")[2]).toEqual({text:"physiotherapie"});
    expect(calls.filter(x=>x[1]==="Input.dispatchKeyEvent")).toHaveLength(0);
  });
  it("deletes selected text by targeted Backspace instead of mutating DOM directly",async()=>{
    const {agent,calls}=harness();
    await agent.run({owner:"user-session",op:"open",args:{url}});
    await agent.run({owner:"user-session",op:"fill",args:{uid:"owl-agent-5",value:""}});
    expect(calls.filter(x=>x[1]==="Input.dispatchKeyEvent")).toHaveLength(2);
    expect(calls.some(x=>x[1]==="Input.insertText")).toBe(false);
  });
  it("refuses other owner's tab and never sends Chromium input",async()=>{
    const {agent,calls}=harness();
    await agent.run({owner:"owner-A",op:"open",args:{url}});
    await expect(agent.run({owner:"owner-B",op:"fill",args:{uid:"owl-agent-5",value:"foo"}}))
      .rejects.toThrow("AGENT_TAB_NOT_OWNED");
    expect(calls).toHaveLength(0);
  });
  it("fails closed for failed preparation and never attaches debugger",async()=>{
    const {agent,calls}=harness();
    await agent.run({owner:"owner-A",op:"open",args:{url}});
    // A stale uid never becomes an arbitrary click/type fallback.
    await expect(agent.run({owner:"owner-A",op:"fill",
      args:{uid:"wrong-id",value:"foo"}})).rejects.toThrow("FILL_ARGUMENT_INVALID");
    expect(calls).toHaveLength(0);
  });
  it("does not present a value as persisted by website merely because DOM changed",async()=>{
    const {agent}=harness();
    await agent.run({owner:"owner-A",op:"open",args:{url}});
    const response=await agent.run({owner:"owner-A",op:"fill",
      args:{uid:"owl-agent-5",value:"shiatsu therapie"}});
    expect(response.websitePersisted).toBe(false);
  });
});

describe("Custom-field page-side safeguards",()=>{
  it("prepares normal inputs and selects existing contents",()=>{
    const el=field({value:"previous"});mount(el);
    expect(prepareTrustedTextField("owl-agent-5",origin)).toMatchObject({ready:true,kind:"native"});
    expect([el.selectionStart,el.selectionEnd]).toEqual([0,8]);
    el.value="osteopathie";
    expect(checkTrustedTextField("owl-agent-5",origin,"osteopathie")).toMatchObject({
      domVerified:true,websitePersisted:false});
  });
  it("can target a role=combobox wrapper with a nested editable input",()=>{
    const input=field({value:"old"});
    const wrapper=field({tag:"DIV",role:"combobox",value:""});
    wrapper.isContentEditable=false;
    wrapper.querySelector=()=>input;
    mount(wrapper);
    expect(prepareTrustedTextField("owl-agent-5",origin)).toMatchObject({ready:true,kind:"native"});
    expect([input.selectionStart,input.selectionEnd]).toEqual([0,3]);
  });
  it("finds a nested input in an open shadow root without accessing the OS",()=>{
    const input=field({value:"old"});
    const shadow={querySelector:()=>input,querySelectorAll:()=>[],activeElement:null};
    input.getRootNode=()=>shadow;
    input.focus=()=>{shadow.activeElement=input};
    const host={shadowRoot:shadow};
    const wrapper=field({tag:"DIV",role:"textbox",value:""});
    wrapper.isContentEditable=false;
    wrapper.querySelector=()=>null;
    wrapper.querySelectorAll=()=>[host];
    mount(wrapper);
    expect(prepareTrustedTextField("owl-agent-5",origin)).toMatchObject({
      ready:true,kind:"native"});
    input.value="chiropraktiker thun";
    expect(checkTrustedTextField("owl-agent-5",origin,"chiropraktiker thun"))
      .toMatchObject({domVerified:true,websitePersisted:false});
  });
  it("permits a real contenteditable textbox, but not a fake div",()=>{
    const editor=field({tag:"DIV",role:"textbox",contenteditable:true,value:"old"});
    mount(editor);
    expect(prepareTrustedTextField("owl-agent-5",origin)).toMatchObject({ready:true,kind:"contenteditable"});
    editor.isContentEditable=false;
    expect(prepareTrustedTextField("owl-agent-5",origin)).toMatchObject({error:"TEXT_TARGET_NOT_EDITABLE"});
  });
  it("rejects credentials, readonly and changed origins",()=>{
    const el=field({label:"One time verification code"});mount(el);
    expect(prepareTrustedTextField("owl-agent-5",origin)).toMatchObject({error:"SENSITIVE_OR_INVALID_FIELD"});
    expect(prepareTrustedTextField("owl-agent-5","https://evil.example")).toMatchObject({error:"TEXT_ORIGIN_CHANGED"});
    mount(el);el.readOnly=true;
    expect(prepareTrustedTextField("owl-agent-5",origin)).toMatchObject({error:"TEXT_TARGET_NOT_WRITABLE"});
  });
});
