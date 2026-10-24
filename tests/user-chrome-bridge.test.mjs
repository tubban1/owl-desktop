import {describe,it,expect} from "vitest";
import {createUserChromeBridge,parseChromePages} from "../connection-host/user-chrome-bridge.mjs";

function fakeConnection(){
 const pages=[{pageId:0,url:"https://personal.example/my-account"}];
 let next=1; const calls=[];
 const respond=(text)=>({content:[{type:"text",text}]});
 const backend={
  async callTool({name,arguments:args}){
   calls.push({name,args});
   switch(name){
    case "list_pages":return respond("# list_pages response\n## Pages\n"+pages.map(p=>p.pageId+": "+p.url).join("\n"));
    case "new_page":{const pageId=next++;pages.push({pageId,url:args.url});return respond("# new_page response\n## Pages\n"+pages.map(p=>p.pageId+": "+p.url).join("\n"));}
    case "take_snapshot":return respond("# take_snapshot response\nuid=1_1 link \"Profile\"\nuid=1_2 textbox \"Bio\"\nuid=1_3 textbox \"Password\"\nuid=1_4 button \"Delete account\"");
    case "fill":return respond("Field filled");
    case "click":return respond("Clicked");
    case "select_page":return respond("Page selected");
    case "take_screenshot":return {content:[{type:"image",mimeType:"image/jpeg",data:"a".repeat(1000)}]};
    case "close_page":{const i=pages.findIndex(p=>p.pageId===args.pageId);if(i<0)throw Error("missing");pages.splice(i,1);return respond("closed");}
    default:throw Error("Unrecognized tool "+name);
   }
  },async close(){},calls,pages
 };
 return backend;
}
describe("native user-Chrome background tabs",()=>{
 it("parses Chrome DevTools MCP selected and background pages",()=>{
  const pages=parseChromePages({content:[{type:"text",text:"## Pages\n0: about:blank\n12: https://www.reddit.com [selected]"}]});
  expect(pages).toEqual([{pageId:0,url:"about:blank"},{pageId:12,url:"https://www.reddit.com"}]);
 });
 it("shares existing Chrome profile but grants ownership only to Agent-created tabs",async()=>{
  const backend=fakeConnection();
  const bridge=createUserChromeBridge({connect:async()=>backend});
  await expect(bridge.open("agentA","file:///etc/passwd")).rejects.toThrow("CHROME_URL_INVALID");
  const one=await bridge.open("agentA","https://www.reddit.com/settings/profile");
  expect(one).toMatchObject({pageId:1,background:true,usesExistingChromeProfile:true});
  expect(backend.calls.find(c=>c.name==="new_page").args).toMatchObject({url:"https://www.reddit.com/settings/profile",background:true});
  const two=await bridge.open("agentA","https://www.reddit.com/r/programming/");
  expect((await bridge.tabs("agentA")).tabs).toHaveLength(2);
  expect((await bridge.tabs("agentB")).tabs).toHaveLength(0);
  expect((await bridge.tabs("agentA")).tabs.map(t=>t.pageId)).toEqual([1,2]);
  await expect(bridge.use("agentB",one.pageId)).rejects.toThrow("CHROME_AGENT_TAB_NOT_OWNED");
  await expect(bridge.use("agentA",0)).rejects.toThrow("CHROME_AGENT_TAB_NOT_OWNED");
  await bridge.use("agentA",one.pageId);
  const snap=await bridge.snapshot("agentA");
  expect(snap.snapshot).toContain("uid=1_2");
  await bridge.fill("agentA","1_2","Test bio");
  await expect(bridge.fill("agentA","1_3","hidden")).rejects.toThrow("CHROME_CREDENTIAL_FIELD_REQUIRES_HUMAN");
  await expect(bridge.click("agentA","1_4")).rejects.toThrow("CHROME_CONSEQUENTIAL_ACTION_REQUIRES_HUMAN");
  const clicked=await bridge.click("agentA","1_1");
  expect(clicked.clicked).toBe(true);
  const shot=await bridge.screenshot("agentA");
  expect(shot.image.mimeType).toBe("image/jpeg");
  await bridge.focusForLogin("agentA");
  expect(backend.calls.filter(x=>x.name==="select_page").at(-1).args).toMatchObject({pageId:1,bringToFront:true});
  await expect(bridge.closeTab("agentB",2)).rejects.toThrow("CHROME_AGENT_TAB_NOT_OWNED");
  await bridge.closeTab("agentA",2);
  expect(backend.pages[0]).toEqual({pageId:0,url:"https://personal.example/my-account"});
  expect((await bridge.tabs("agentA")).tabs).toHaveLength(1);
  await bridge.close();
 });
 it("keeps user Chrome connection shared across OWL Session owners",async()=>{
  const backend=fakeConnection();
  let connects=0;
  const bridge=createUserChromeBridge({connect:async()=>{connects++;return backend;}});
  await Promise.all([
   bridge.open("owner-a","https://www.reddit.com/a"),
   bridge.open("owner-b","https://www.reddit.com/b"),
  ]);
  expect(connects).toBe(1);
  expect((await bridge.tabs("owner-a")).tabs).toHaveLength(1);
  expect((await bridge.tabs("owner-b")).tabs).toHaveLength(1);
  const before=await bridge.status();
  expect(before.connected).toBe(true);
  expect(backend.calls.filter(x=>x.name==="new_page")).toHaveLength(2);
  expect(backend.calls.filter(x=>x.name==="new_page").every(x=>x.args.background===true)).toBe(true);
  await bridge.close();
 });
});
