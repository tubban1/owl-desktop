import {describe,it,expect} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {startNativeMessagingBroker} from "../connection-host/native-messaging-broker.mjs";
import {createNativeChromeBridge} from "../connection-host/native-user-chrome-bridge.mjs";
import {frame,decoder} from "../connection-host/native-messaging-host.mjs";
import {createNativeAgentExecutor} from "../chrome-agent-native/agent-executor.mjs";

describe("Chrome native messaging transport",()=>{
 it("frames and decodes split binary messages with UTF-8",()=>{
  const incoming=[];const feed=decoder(v=>incoming.push(v));
  const a=frame({message:"你好 🌿",type:"status"}),b=frame({value:3});
  feed(a.subarray(0,2));feed(a.subarray(2,8));feed(Buffer.concat([a.subarray(8),b]));
  expect(incoming).toEqual([{message:"你好 🌿",type:"status"},{value:3}]);
 });
 it("rejects localhost calls without private bearer, routes owner commands, and deletes private token on close",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-native-test-"));
  const config=path.join(dir,"broker.json");
  let broker;
  try{
   broker=await startNativeMessagingBroker({port:0,configPath:config,deadlineMs:4000});
   const {port,token}=JSON.parse(await fs.readFile(config,"utf8"));
   expect((await fs.stat(config)).mode&0o077).toBe(0);
   const url="http://127.0.0.1:"+port;
   const post=async(p,body={},auth=token)=>{
    const r=await fetch(url+p,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+auth},body:JSON.stringify(body)});
    return {status:r.status,data:await r.json()};
   };
   expect((await post("/v1/native/poll",{},"bad")).status).toBe(401);
   expect((await post("/v1/native/poll")).data.request).toBe(null);
   const bridge=createNativeChromeBridge({broker});
   const pending=bridge.open("owl-session-1","https://www.reddit.com/settings");
   const polled=await post("/v1/native/poll");
   expect(polled.data.request).toMatchObject({owner:"owl-session-1",op:"open",args:{url:"https://www.reddit.com/settings"}});
   const id=polled.data.request.id;
   expect((await post("/v1/native/result",{id,ok:true,result:{pageId:42,background:true}})).status).toBe(200);
   expect(await pending).toMatchObject({pageId:42,background:true});
   expect((await post("/v1/native/result",{id,ok:true,result:{}})).status).toBe(404);
   expect(bridge.status().connected).toBe(true);
   await expect(broker.request("","open",{})).rejects.toThrow("NATIVE_OWNER_REQUIRED");
  }finally{await broker?.close();expect(await fs.stat(config).catch(()=>null)).toBeNull();await fs.rm(dir,{recursive:true,force:true});}
 });
});

function fakeChrome(){
 const all=new Map([[5,{id:5,url:"https://human.example",windowId:1}]]);
 let next=6;const calls=[];
 const st={};
 const chrome={
  storage:{session:{get:async key=>({[key]:st[key]}),set:async data=>Object.assign(st,data)}},
  tabs:{
   create:async({url,active})=>{calls.push(["create",active]);const tab={id:next++,url,windowId:1};all.set(tab.id,tab);return tab;},
   get:async id=>{if(!all.has(id))throw Error("not found");return all.get(id);},
   remove:async id=>{calls.push(["remove",id]);all.delete(id);},
   update:async(id,args)=>{calls.push(["update",id,args]);return all.get(id);}
  },
  windows:{update:async(id,args)=>{calls.push(["focus",id,args]);}},
  scripting:{executeScript:async({target,func,args})=>[{result:func.name==="inspect"?{title:"Page",url:all.get(target.tabId).url,text:"Bio",controls:[{uid:"owl-agent-1",label:"Bio"}]}:{filled:true}}]},
  debugger:{attach:async target=>{calls.push(["attach",target.tabId]);},sendCommand:async()=>({data:"abcd"}),detach:async target=>{calls.push(["detach",target.tabId]);}}
 };
 return {chrome,all,calls,storage:chrome.storage.session};
}
describe("Agent-owned Chrome tab isolation",()=>{
 it("never selects/reads/closes user or another Session's tab",async()=>{
  const c=fakeChrome(),x=createNativeAgentExecutor(c.chrome,c.storage);
  const a=await x.run({owner:"agent-A",op:"open",args:{url:"https://www.reddit.com/settings"}});
  const b=await x.run({owner:"agent-B",op:"open",args:{url:"https://example.org"}});
  expect(a.background).toBe(true);
  expect(c.calls.filter(call=>call[0]==="create").every(c=>c[1]===false)).toBe(true);
  expect((await x.run({owner:"agent-A",op:"tabs"})).tabs).toHaveLength(1);
  expect((await x.run({owner:"agent-B",op:"tabs"})).tabs).toHaveLength(1);
  await expect(x.run({owner:"agent-A",op:"use",args:{pageId:b.pageId}})).rejects.toThrow("AGENT_TAB_NOT_OWNED");
  await expect(x.run({owner:"agent-A",op:"use",args:{pageId:5}})).rejects.toThrow("AGENT_TAB_NOT_OWNED");
  await expect(x.run({owner:"agent-A",op:"close_tab",args:{pageId:5}})).rejects.toThrow("AGENT_TAB_NOT_OWNED");
  expect((await x.run({owner:"agent-A",op:"snapshot"})).snapshot.controls).toHaveLength(1);
  expect((await x.run({owner:"agent-A",op:"screenshot"})).image).toEqual({type:"image",mimeType:"image/jpeg",data:"abcd"});
  expect(c.calls.filter(a=>a[0]==="attach")).toEqual([["attach",a.pageId]]);
  await x.run({owner:"agent-A",op:"focus_login"});
  expect(c.calls.some(v=>v[0]==="update"&&v[1]===a.pageId&&v[2].active===true)).toBe(true);
  await x.run({owner:"agent-A",op:"close_tab",args:{pageId:a.pageId}});
  expect(c.all.has(5)).toBe(true);
  expect(c.all.has(b.pageId)).toBe(true);
 });
 it("rejects unsafe schemes and bad owners",async()=>{
  const c=fakeChrome(),x=createNativeAgentExecutor(c.chrome,c.storage);
  await expect(x.run({owner:"agent-A",op:"open",args:{url:"file:///private/etc/passwd"}})).rejects.toThrow("NATIVE_URL_INVALID");
  await expect(x.run({owner:"",op:"open",args:{url:"https://example.org"}})).rejects.toThrow("NATIVE_OWNER_INVALID");
 });
});
