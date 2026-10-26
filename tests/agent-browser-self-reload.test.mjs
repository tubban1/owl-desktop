import {describe,it,expect} from "vitest";
import {readFile} from "node:fs/promises";
import {createNativeAgentExecutor} from "../chrome-agent-native/agent-executor.mjs";
import {createNativeChromeBridge} from "../connection-host/native-user-chrome-bridge.mjs";

const TEST_URL="https://ads.google.com/aw/express/campaigns/18391919022";
const OWNER="test-owner";
function memoryStore(){
  let data={};
  return {get:async key=>({[key]:data[key]}),
    set:async value=>Object.assign(data,value),
    remove:async key=>{delete data[key]},
    state:()=>data,clear:()=>{data={}}};
}
function chromeFixture(){
 const session=memoryStore(),local=memoryStore();
 const tabs=new Map();
 let next=100;
 const chrome={
   storage:{session,local},
   runtime:{getManifest:()=>({version:"0.4.1"})},
   tabs:{
     query:async()=>[...tabs.values()],
     create:async({url,active})=>{
       const tab={id:next++,url,active,incognito:false};
       tabs.set(tab.id,tab);return tab;
     },
     get:async id=>{
       if(!tabs.has(id))throw Error("closed");
       return tabs.get(id);
     }
   }
 };
 return {chrome,session,local,tabs};
}

describe("Native Chrome self-reload session recovery",()=>{
 it("returns honest capabilities, saves short-lived ownership, restores after reload",async()=>{
   const f=chromeFixture();
   const first=createNativeAgentExecutor(f.chrome,f.session);
   const opened=await first.run({owner:OWNER,op:"open",args:{url:TEST_URL}});
   expect(opened.tabCreated).toBe(true);
   const info=await first.run({owner:OWNER,op:"extension_info"});
   expect(info).toMatchObject({version:"0.4.1",selfReloadProtocol:1,canSelfReload:true});
   const prepared=await first.run({owner:OWNER,op:"extension_prepare_reload",
     args:{expectedVersion:"0.4.1"}});
   expect(prepared).toMatchObject({reloadPrepared:true,ownerTabsPreserved:1,
     previousInstanceId:info.instanceId});
   expect(f.local.state().owlNativeReloadCheckpoint.version).toBe(1);
   f.session.clear(); // chrome.storage.session may clear on extension reload
   const second=createNativeAgentExecutor(f.chrome,f.session);
   const next=await second.run({owner:OWNER,op:"extension_info"});
   expect(next.instanceId).not.toBe(info.instanceId);
   const restored=await second.run({owner:OWNER,op:"tabs"});
   expect(restored.tabs).toMatchObject([{pageId:opened.pageId,selected:true}]);
   expect(f.local.state().owlNativeReloadCheckpoint).toBeUndefined();
   expect((await second.run({owner:"different-agent",op:"tabs"})).tabs).toHaveLength(0);
   await expect(second.run({owner:"different-agent",op:"snapshot"}))
     .rejects.toThrow("AGENT_TAB_NOT_OWNED");
 });
 it("never restores expired grants or pages closed while reloading",async()=>{
   const f=chromeFixture(),first=createNativeAgentExecutor(f.chrome,f.session);
   const tab=await first.run({owner:OWNER,op:"open",args:{url:TEST_URL}});
   await first.run({owner:OWNER,op:"extension_prepare_reload",
     args:{expectedVersion:"0.4.1"}});
   f.session.clear();
   f.local.state().owlNativeReloadCheckpoint.expiresAt=Date.now()-100;
   const second=createNativeAgentExecutor(f.chrome,f.session);
   expect((await second.run({owner:OWNER,op:"tabs"})).tabs).toHaveLength(0);
   expect(f.local.state().owlNativeReloadCheckpoint).toBeUndefined();
   f.local.state().owlNativeExtensionReloadAt=Date.now()-30_000;
   const third=createNativeAgentExecutor(f.chrome,f.session);
   await third.run({owner:OWNER,op:"open",args:{url:TEST_URL}});
   await third.run({owner:OWNER,op:"extension_prepare_reload",
     args:{expectedVersion:"0.4.1"}});
   f.tabs.delete(tab.pageId);
   f.session.clear();
   const fourth=createNativeAgentExecutor(f.chrome,f.session);
   expect((await fourth.run({owner:OWNER,op:"tabs"})).tabs).toHaveLength(0);
 });
 it("rate limits repeated reload attempts without losing current ownership",async()=>{
   const f=chromeFixture(),agent=createNativeAgentExecutor(f.chrome,f.session);
   await agent.run({owner:OWNER,op:"open",args:{url:TEST_URL}});
   await agent.run({owner:OWNER,op:"extension_prepare_reload",
     args:{expectedVersion:"0.4.1"}});
   await expect(agent.run({owner:OWNER,op:"extension_prepare_reload",
     args:{expectedVersion:"0.4.1"}}))
     .rejects.toThrow("EXTENSION_RELOAD_RATE_LIMITED");
   expect((await agent.run({owner:OWNER,op:"tabs"})).tabs).toHaveLength(1);
 });
 it("fails closed for missing storage.local or invalid version",async()=>{
   const f=chromeFixture(),agent=createNativeAgentExecutor(f.chrome,f.session);
   await expect(agent.run({owner:OWNER,op:"extension_prepare_reload",
     args:{expectedVersion:"bad-version"}}))
       .rejects.toThrow("EXTENSION_EXPECTED_VERSION_INVALID");
   delete f.chrome.storage.local;
   const other=createNativeAgentExecutor(f.chrome,f.session);
   await expect(other.run({owner:OWNER,op:"extension_prepare_reload",
     args:{expectedVersion:"0.4.1"}}))
       .rejects.toThrow("EXTENSION_PERSISTENT_CHECKPOINT_UNAVAILABLE");
 });
 it("restored adopted tabs do not silently gain access to a changed origin",async()=>{
   const f=chromeFixture();
   f.tabs.set(13,{id:13,url:TEST_URL,active:false,incognito:false});
   const first=createNativeAgentExecutor(f.chrome,f.session);
   const opened=await first.run({owner:OWNER,op:"open",args:{url:TEST_URL}});
   expect(opened.adoptedHumanTab).toBe(true);
   await first.run({owner:OWNER,op:"extension_prepare_reload",
     args:{expectedVersion:"0.4.1"}});
   f.tabs.get(13).url="https://accounts.google.com/";
   f.session.clear();
   const second=createNativeAgentExecutor(f.chrome,f.session);
   expect((await second.run({owner:OWNER,op:"tabs"})).tabs).toEqual([]);
 });
 it("extension worker schedules runtime.reload only after messaging success",async()=>{
   const file=await readFile(new URL("../chrome-agent-native/service-worker.mjs",import.meta.url),"utf8");
   expect(file).toContain('if(message.op==="extension_prepare_reload"&&result?.reloadPrepared)');
   expect(file).toContain('p.postMessage({type:"result",id:message.id,ok:true,result})');
   expect(file).toContain('setTimeout(()=>chrome.runtime.reload(),350)');
   expect(file).not.toContain("chrome.management.setEnabled");
 });
});

describe("Host-controlled Chrome reload attestation",()=>{
 function fakeBridge(responses){
   const requests=[];
   const broker={status:()=>({connected:true}),request:async(owner,op,args)=>{
     requests.push({owner,op,args});
     const response=responses.shift();
     if(response instanceof Error)throw response;
     return response;
   }};
   return {bridge:createNativeChromeBridge({broker}),requests};
 }
 it("verifies a fresh worker instance and matching target version",async()=>{
   const a=fakeBridge([
     {selfReloadProtocol:1,instanceId:"one",version:"0.4.0"},
     {reloadPrepared:true,previousInstanceId:"one",expectedVersion:"0.4.1"},
     {selfReloadProtocol:1,instanceId:"two",version:"0.4.1"}
   ]);
   const result=await a.bridge.reloadExtension(OWNER,"0.4.1");
   expect(result).toMatchObject({reloaded:true,verified:true,
     previousVersion:"0.4.0",version:"0.4.1",newInstance:true});
   expect(a.requests.map(x=>x.op)).toEqual([
     "extension_info","extension_prepare_reload","extension_info"]);
 });
 it("legacy extensions cannot pretend self-reload is available",async()=>{
   const a=fakeBridge([new Error("NATIVE_ACTION_NOT_ALLOWED")]);
   await expect(a.bridge.reloadExtension(OWNER,"0.4.1"))
     .rejects.toThrow("EXTENSION_RELOAD_BOOTSTRAP_REQUIRED");
   expect(a.requests.map(x=>x.op)).toEqual(["extension_info"]);
 });
 it("rejects a mismatched version even when Native Messaging reconnects",async()=>{
   const a=fakeBridge([
     {selfReloadProtocol:1,instanceId:"one",version:"0.4.0"},
     {reloadPrepared:true,previousInstanceId:"one"},
     {selfReloadProtocol:1,instanceId:"two",version:"0.4.0"}
   ]);
   await expect(a.bridge.reloadExtension(OWNER,"0.4.1"))
     .rejects.toThrow("EXTENSION_RELOAD_VERSION_MISMATCH");
 });
 it("validates requested version before the first remote call",async()=>{
   const a=fakeBridge([]);
   await expect(a.bridge.reloadExtension(OWNER,"not-a-version"))
     .rejects.toThrow("EXTENSION_EXPECTED_VERSION_REQUIRED");
   expect(a.requests).toHaveLength(0);
 });
});
