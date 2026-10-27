import {describe,it,expect} from "vitest";
import {createNativeAgentExecutor} from "../chrome-agent-native/agent-executor.mjs";
import {prepareTrustedTextField,locateTrustedTextActivation,
  checkTrustedTextField} from "../chrome-agent-native/trusted-text-field.mjs";

function fakeBrowser({reveal=true,initialError=null}={}){
 const events=[],data={},tabs=new Map();let nextId=1200;
 let focusEmulated=false,clicked=false;
 const session={get:async key=>({[key]:data[key]}),
   set:async obj=>Object.assign(data,obj)};
 const chrome={
  storage:{session},
  tabs:{
   query:async()=>[...tabs.values()],
   create:async({url,active})=>{const tab={id:nextId++,url,active,incognito:false,windowId:1};
     tabs.set(tab.id,tab);events.push("create-background-tab");return tab;},
   get:async id=>tabs.get(id),
   update:async()=>{throw Error("FOREGROUND_CHANGE_FORBIDDEN")}
  },
  windows:{update:async()=>{throw Error("WINDOW_FOCUS_FORBIDDEN")}},
  scripting:{executeScript:async({func})=>{
   if(func===prepareTrustedTextField){
    events.push("prepare");
    return [{result:initialError?{error:initialError}:
      clicked&&reveal?{ready:true,kind:"native"}:{activationRequired:true}}];
   }
   if(func===locateTrustedTextActivation)return [{result:{valid:true,x:100,y:100}}];
   if(func===checkTrustedTextField)return [{result:{domVerified:true}}];
   throw Error("UNEXPECTED_INJECTION");
  }},
  debugger:{
   attach:async()=>events.push("attach"),
   detach:async()=>events.push("detach"),
   sendCommand:async(_target,method,options)=>{
    events.push(method);
    if(method==="Emulation.setFocusEmulationEnabled")focusEmulated=options.enabled===true;
    if(method==="Input.dispatchMouseEvent"&&options.type==="mouseReleased")
      clicked=focusEmulated;
    return {};
   }
  }
 };
 const executor=createNativeAgentExecutor(chrome,session);
 return {executor,events};
}
async function openAndFill(instance){
 await instance.executor.run({owner:"agent-test",op:"open",args:{url:"https://example.test/editor"}});
 return instance.executor.run({owner:"agent-test",op:"fill",
   args:{uid:"owl-agent-1",value:"local-test"}});
}
describe("Agent Browser background lazy text field activation",()=>{
 it("emulates tab focus before trusted click, verifies input without changing foreground",async()=>{
  const b=fakeBrowser();
  const out=await openAndFill(b);
  expect(out).toMatchObject({filled:true,domVerified:true,activatedWidget:true,
    foregroundUnchanged:true,systemKeyboardUsed:false});
  const order=["Page.enable","Emulation.setFocusEmulationEnabled",
    "Input.dispatchMouseEvent","Input.insertText","detach"];
  let pos=-1;
  for(const step of order){
   pos=b.events.indexOf(step,pos+1);
   expect(pos,step).toBeGreaterThan(-1);
  }
  expect(b.events).not.toContain("FOREGROUND_CHANGE");
 });
 it("never types if trusted activation has not revealed exactly one editable target",async()=>{
  const b=fakeBrowser({reveal:false});
  await expect(openAndFill(b)).rejects.toThrow("TEXT_ACTIVATION_DID_NOT_REVEAL_EDITABLE");
  expect(b.events).not.toContain("Input.insertText");
  expect(b.events).toContain("detach");
 });
 it("refuses sensitive fields before attaching a debugger",async()=>{
  const b=fakeBrowser({initialError:"SENSITIVE_OR_INVALID_FIELD"});
  await expect(openAndFill(b)).rejects.toThrow("SENSITIVE_OR_INVALID_FIELD");
  expect(b.events).not.toContain("attach");
 });
});
