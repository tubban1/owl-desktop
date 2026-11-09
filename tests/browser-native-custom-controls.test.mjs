import {describe,it,expect,vi,afterEach} from "vitest";
import {executeFormAction} from "../chrome-agent-native/form-controls.mjs";
import {locateVirtualCursorTarget} from "../chrome-agent-native/virtual-cursor.mjs";
import {createNativeAgentExecutor} from "../chrome-agent-native/agent-executor.mjs";
import {createNativeChromeBridge} from "../connection-host/native-user-chrome-bridge.mjs";
import {detectPageReceipt} from "../chrome-agent-native/download-workflow.mjs";

const OWNER="agent-test-owner",URL="https://channels.weixin.qq.com/platform/post/create";
const ORIGIN="https://channels.weixin.qq.com";
afterEach(()=>vi.unstubAllGlobals());

function makeCheckbox(){
  let checked=false;
  const checkbox={
    tagName:"INPUT",name:"originality",disabled:false,readOnly:false,
    getAttribute:k=>k==="type"?"checkbox":k==="data-owl-agent-control"?"owl-agent-12":null,
    click(){checked=!checked;},matches:selector=>selector.includes("input"),labels:[],parentElement:{textContent:"声明原创"},
    get checked(){return checked;},get value(){return "on";}
  };
  const shadow={querySelectorAll:()=>[checkbox],querySelector:()=>checkbox};
  const host={shadowRoot:shadow,matches:()=>false};
  vi.stubGlobal("location",{origin:ORIGIN,href:URL});
  vi.stubGlobal("CSS",{escape:s=>s});
  vi.stubGlobal("document",{
    querySelectorAll:()=>[host],
    querySelector:()=>null
  });
  return checkbox;
}

describe("custom field discovery in Agent-owned shadow roots",()=>{
  it("inspects and checks a native originality checkbox inside an open shadow root",()=>{
    const control=makeCheckbox();
    const result=executeFormAction("inspect",{origin:ORIGIN});
    expect(result.controls).toMatchObject([{uid:"owl-agent-12",type:"checkbox",
      checked:false,label:"声明原创"}]);
    const changed=executeFormAction("set",{uid:"owl-agent-12",origin:ORIGIN,
      change:{checked:true}});
    expect(changed).toMatchObject({checked:true,domVerified:true,websitePersisted:false});
    expect(control.checked).toBe(true);
  });
  it("rejects different origin even with a valid observed UID",()=>{
    makeCheckbox();
    expect(executeFormAction("set",{origin:"https://evil.example",uid:"owl-agent-12",
      change:{checked:true}})).toMatchObject({error:"FORM_ORIGIN_CHANGED"});
  });
});

function cursor(label,kind="choice"){
  const e={
    tagName:"DIV",textContent:label,className:kind==="choice"?"weui-select-trigger":"payment-button",
    disabled:false,readOnly:false,children:[],
    getAttribute(name){
      if(name==="type")return "";
      if(name==="class")return this.className;
      return null;
    },hasAttribute:()=>false,closest:()=>null,
    contains(node){return node===this;},getRootNode:()=>({}),
    getBoundingClientRect:()=>({left:30,right:230,top:70,bottom:108,width:200,height:38})
  };
  vi.stubGlobal("location",{origin:ORIGIN,hostname:"channels.weixin.qq.com",pathname:"/platform/post/create"});
  vi.stubGlobal("CSS",{escape:s=>s});
  vi.stubGlobal("innerWidth",1400);vi.stubGlobal("innerHeight",900);
  vi.stubGlobal("getComputedStyle",()=>({visibility:"visible",display:"block",
    pointerEvents:"auto",cursor:"pointer"}));
  vi.stubGlobal("document",{querySelector:()=>e,elementFromPoint:()=>e});
  return e;
}
describe("safe background custom-choice cursor",()=>{
  it("allows a pointer-operated custom collection dropdown",()=>{
    cursor("选择合集");
    expect(locateVirtualCursorTarget("owl-agent-21",ORIGIN,"click"))
      .toMatchObject({valid:true,tag:"div"});
  });
  it("selects a WeChat Channels collection row but rejects lookalikes elsewhere",()=>{
    cursor("Agent陷阱共3个内容","payment");
    expect(locateVirtualCursorTarget("owl-agent-15",ORIGIN,"click"))
      .toMatchObject({valid:true,tag:"div"});
    vi.stubGlobal("location",{origin:"https://example.org",hostname:"example.org",
      pathname:"/platform/post/create"});
    expect(locateVirtualCursorTarget("owl-agent-15","https://example.org","click"))
      .toMatchObject({error:"CURSOR_UNSUPPORTED_CONTROL"});
  });
  it("still blocks ambiguous payment actions",()=>{
    cursor("确认付款");
    expect(locateVirtualCursorTarget("owl-agent-21",ORIGIN,"click"))
      .toMatchObject({error:"CURSOR_ACTION_REQUIRES_HUMAN"});
  });
  it("accepts an explicitly labeled upload tile only in upload mode",()=>{
    cursor("支持上传不超过20GB的视频");
    expect(locateVirtualCursorTarget("owl-agent-8",ORIGIN,"click"))
      .toMatchObject({error:"CURSOR_ACTION_REQUIRES_HUMAN"});
    expect(locateVirtualCursorTarget("owl-agent-8",ORIGIN,"upload"))
      .toMatchObject({valid:true});
    cursor("确认付款");
    expect(locateVirtualCursorTarget("owl-agent-8",ORIGIN,"upload"))
      .toMatchObject({error:"UPLOAD_TRIGGER_NOT_APPROVED"});
  });
});

function browserFixture({chooser=true,attrs=["type","file","accept",".mp4"],
                       eventTabId=91}={}){
  const state={},calls=[];let onEvent=null;
  const storage={get:async key=>({[key]:state[key]}),
    set:async data=>Object.assign(state,data)};
  const chrome={
    storage:{session:storage},tabs:{
      query:async()=>[],
      create:async data=>({id:91,url:data.url,active:false,windowId:2}),
      get:async()=>({id:91,url:URL,active:false,windowId:2})
    },
    scripting:{executeScript:async ({func})=>{
      if(func.name==="locateVirtualCursorTarget")return [{result:{valid:true,x:300,y:200}}];
      if(func.name==="detectPageReceipt")return [{result:{observed:false}}];
      return [{result:{ok:true}}];
    }},
    debugger:{
      onEvent:{addListener(fn){onEvent=fn;},removeListener(fn){if(onEvent===fn)onEvent=null;}},
      attach:async()=>{calls.push({method:"attach"});},
      sendCommand:async(_target,method,args)=>{
        calls.push({method,args});
        if(method==="Input.dispatchMouseEvent"&&args.type==="mouseReleased"&&chooser)
          onEvent?.({tabId:eventTabId},"Page.fileChooserOpened",
            {backendNodeId:777,mode:"selectSingle"});
        if(method==="DOM.describeNode")return {node:{nodeName:"INPUT",attributes:attrs}};
        return {};
      },
      detach:async()=>{calls.push({method:"detach"});}
    }
  };
  return {chrome,storage,calls};
}
const video=[{stagedPath:"/tmp/approved.mp4",filename:"approved.mp4",mime:"video/mp4"}];
describe("intercepted upload chooser",()=>{
  it("uses owner-scoped Chrome CDP without native picker or OS pointer",async()=>{
    const b=browserFixture(),agent=createNativeAgentExecutor(b.chrome,b.storage);
    await agent.run({owner:OWNER,op:"open",args:{url:URL}});
    const res=await agent.run({owner:OWNER,op:"upload_picker",args:{
      pageId:91,targetUid:"owl-agent-8",origin:ORIGIN,files:video}});
    expect(res).toMatchObject({selected:true,selectedCount:1,websiteUploadVerified:false,
      foregroundUnchanged:true,osPointerMoved:false,inputMethod:"tab_scoped_intercepted_chooser"});
    expect(b.calls.filter(x=>x.method==="DOM.setFileInputFiles")).toHaveLength(1);
    expect(b.calls.find(x=>x.method==="DOM.setFileInputFiles").args)
      .toMatchObject({backendNodeId:777,files:["/tmp/approved.mp4"]});
    expect(b.calls.map(x=>x.method)).toContain("Page.setInterceptFileChooserDialog");
    expect(b.calls.map(x=>x.method)).not.toContain("tabs.update");
    expect(b.calls.at(-1).method).toBe("detach");
  });
  it("fails closed on foreign owner or invalid input node",async()=>{
    const b=browserFixture({attrs:["type","text"]}),
      agent=createNativeAgentExecutor(b.chrome,b.storage);
    await agent.run({owner:OWNER,op:"open",args:{url:URL}});
    await expect(agent.run({owner:"foreign-owner",op:"upload_picker",args:{
      pageId:91,targetUid:"owl-agent-8",origin:ORIGIN,files:video}}))
      .rejects.toThrow("AGENT_TAB_NOT_OWNED");
    await expect(agent.run({owner:OWNER,op:"upload_picker",args:{
      pageId:91,targetUid:"owl-agent-8",origin:ORIGIN,files:video}}))
      .rejects.toThrow("UPLOAD_CHOOSER_INPUT_NOT_VERIFIED");
    expect(b.calls.filter(x=>x.method==="DOM.setFileInputFiles")).toHaveLength(0);
    expect(b.calls.at(-1).method).toBe("detach");
  });
  it("prevents accept-type mismatch even for a matching file picker",async()=>{
    const b=browserFixture({attrs:["type","file","accept",".jpg"]}),
      agent=createNativeAgentExecutor(b.chrome,b.storage);
    await agent.run({owner:OWNER,op:"open",args:{url:URL}});
    await expect(agent.run({owner:OWNER,op:"upload_picker",args:{
      pageId:91,targetUid:"owl-agent-8",origin:ORIGIN,files:video}}))
      .rejects.toThrow("UPLOAD_ACCEPT_MISMATCH");
    expect(b.calls.filter(x=>x.method==="DOM.setFileInputFiles")).toHaveLength(0);
  });
  it("rejects a wrong page before Chrome debugger attach",async()=>{
    const b=browserFixture(),agent=createNativeAgentExecutor(b.chrome,b.storage);
    await agent.run({owner:OWNER,op:"open",args:{url:URL}});
    await expect(agent.run({owner:OWNER,op:"upload_picker",args:{
      pageId:92,targetUid:"owl-agent-8",origin:ORIGIN,files:video}}))
      .rejects.toThrow("UPLOAD_PICKER_ARGUMENT_INVALID");
    expect(b.calls).toHaveLength(0);
  });
  it("host bridge cannot attach files to unobserved controls",async()=>{
    const reqs=[];
    const bridge=createNativeChromeBridge({
      broker:{status:()=>({connected:true}),request:async(_,op,args)=>{
        reqs.push(op);
        if(op==="snapshot")return {pageId:91,snapshot:{url:URL,controls:[]}};
        throw Error("should not request "+op);
      }},
      uploadBroker:{resolve:async()=>video}
    });
    await expect(bridge.uploadPicker(OWNER,{pageId:91,targetUid:"owl-agent-8",
      fileTickets:["a".repeat(48)]})).rejects.toThrow("UPLOAD_TRIGGER_NOT_OBSERVED");
    expect(reqs).toEqual(["snapshot"]);
  });
});