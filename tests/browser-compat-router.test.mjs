import {describe,it,expect} from "vitest";
import {createBrowserCompatRouter} from "../mcp/browser-compat-router.mjs";
function fixture() {
 const state={owner:"sessionA",tabs:[],selected:null,calls:[]};
 const bridge={
  open:async(owner,url)=>{state.calls.push(["native.open",owner,url]);const pageId=state.tabs.length+11;state.tabs.push({pageId,url,selected:true});state.tabs.forEach(x=>x.selected=x.pageId===pageId);return {pageId,background:true};},
  tabs:async()=>({tabs:state.tabs}),
  use:async(_,pageId)=>{state.selected=pageId;return {pageId,selected:true};},
  closeTab:async(_,pageId)=>{state.calls.push(["native.close",pageId]);return {closed:true,pageId};},
  snapshot:async()=>({snapshot:{controls:[{uid:"owl-agent-1",label:"Bio"}]}}),
  click:async(_,uid)=>{state.calls.push(["native.click",uid]);return {clicked:true};},
  fill:async(_,uid,text)=>{state.calls.push(["native.fill",uid,text]);return {filled:true};},
  screenshot:async()=>({image:{type:"image",mimeType:"image/jpeg",data:"abcd"},pageId:11})
 };
 const router=createBrowserCompatRouter({
   native:()=>({bridge,owner:state.owner}),
   sessionId:()=>state.owner,
   isolated:async(p,op,args)=>{state.calls.push(["isolated",p,op,args]);return {isolated:true}}
 });
 return {router,state};
}
describe("shared browser compatibility defaults",()=>{
 it("uses user's existing Chrome tab by default without launching Chromium",async()=>{
  const {router,state}=fixture();
  expect(await router.open({url:"https://example.org"})).toMatchObject({browserMode:"existing-chrome",newBrowserProcess:false});
  expect((await router.tabs()).tabs).toHaveLength(1);
  expect((await router.snapshot()).snapshot.controls[0].uid).toBe("owl-agent-1");
  expect(state.calls.map(x=>x[0])).toEqual(["native.open"]);
 });
 it("requires explicit isolated mode, and keeps mode scoped to owner",async()=>{
  const {router,state}=fixture();
  await router.open({url:"https://example.org",mode:"isolated"});
  await router.snapshot();
  expect(state.calls.map(x=>x[0])).toEqual(["isolated","isolated"]);
  state.owner="anotherSession";
  await router.open({url:"https://example.org"});
  expect(router.currentMode()).toBe("chrome");
 });
 it("fails closed on missing native transport rather than silently launching isolated browser",async()=>{
  const router=createBrowserCompatRouter({native:()=>null,sessionId:()=> "a",isolated:()=>{throw Error("ISOLATED_USED");}});
  await expect(router.open({url:"https://example.org"})).rejects.toThrow("CHROME_NATIVE_BRIDGE_UNAVAILABLE");
  await expect(router.snapshot()).rejects.toThrow("CHROME_NATIVE_BRIDGE_UNAVAILABLE");
 });
 it("does not silently replay CSS selectors or submit an unreviewed form",async()=>{
  const {router,state}=fixture();
  await router.open({url:"https://example.org"});
  await expect(router.click({selector:"#save"})).rejects.toThrow("CHROME_NATIVE_UID_REQUIRED");
  await expect(router.type({selector:"owl-agent-1",text:"hello",submit:true})).rejects.toThrow("CHROME_NATIVE_SUBMIT_REQUIRES_REVIEW");
  await router.type({selector:"owl-agent-1",text:"hello"});
  expect(state.calls.at(-1)).toEqual(["native.fill","owl-agent-1","hello"]);
 });
 it("returns inline native screenshots without falsely claiming that a path was written",async()=>{
  const {router}=fixture();
  const result=await router.screenshot({path:"/tmp/a.png"});
  expect(result).toMatchObject({isolated:false,storedToRequestedPath:false,requestedFilePath:"/tmp/a.png",image:{type:"image"}});
 });
 it("only closes the currently selected agent tab",async()=>{
  const {router,state}=fixture();
  await router.open({url:"https://example.org"});
  await router.close();
  expect(state.calls.at(-1)).toEqual(["native.close",11]);
 });
});