import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {startChromeCompanionBroker} from "../connection-host/chrome-companion-broker.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require("/Users/wahaha/node_modules/playwright");
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),"owl-agent-tabs-real-"));
const extension=path.join(scratch,"extension");
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../chrome-companion");
await fs.cp(source,extension,{recursive:true});
let browser,bridge;
const server=http.createServer((req,res)=>{
  res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
  const title=req.url?.startsWith("/agent")?"Agent workspace":"Human workspace";
  res.end('<!doctype html><title>'+title+'</title><h1>'+title+'</h1><input id="note" value=""><a id="details" href="/agent/details">View details</a><button id="save" type="submit">Save</button>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const address=server.address();
assert.ok(address&&typeof address!=="string");
const website="http://127.0.0.1:"+address.port;
const owner="owl-workstream:agent-background-qa";
try{
  bridge=await startChromeCompanionBroker({port:0});
  const workerPath=path.join(extension,"service-worker.mjs");
  const code=await fs.readFile(workerPath,"utf8");
  assert.ok(code.includes('const BROKER="http://127.0.0.1:8794"'));
  await fs.writeFile(workerPath,code.replace('const BROKER="http://127.0.0.1:8794"', 'const BROKER="'+bridge.url+'"'));
  browser=await chromium.launchPersistentContext(path.join(scratch,"profile"),{
    headless:true,channel:"chromium",
    args:["--disable-extensions-except="+extension,"--load-extension="+extension],
    timeout:20000,
  });
  let worker=browser.serviceWorkers()[0];
  if(!worker)worker=await browser.waitForEvent("serviceworker",{timeout:12000});
  const id=new URL(worker.url()).host;
  const human=await browser.newPage();
  await human.goto(website+"/human");
  const popup=await browser.newPage();
  await popup.goto("chrome-extension://"+id+"/popup.html");
  await popup.locator("#code").fill(bridge.pair(owner).code);
  await popup.locator("#pair").click();
  await popup.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("已连接 OWL"));
  await human.bringToFront();
  const permission=await popup.evaluate(origin=>chrome.runtime.sendMessage({op:"grantAgentSite",origin}),website);
  assert.equal(permission.ok,true,JSON.stringify(permission));
  const created=await bridge.command("agent_open",{url:website+"/agent"},owner);
  assert.equal(created.background,true);
  assert.ok(created.tabId>=0);
  let agentPage=browser.pages().find(x=>x.url()===website+"/agent");
  if(!agentPage)agentPage=await browser.waitForEvent("page",{timeout:15000,predicate:p=>p.url()===website+"/agent"});
  await agentPage.locator("h1").waitFor();
  const listing=await bridge.command("agent_tabs",{},owner);
  assert.equal(listing.tabs.filter(x=>x.active).length,1);
  assert.equal(listing.tabs[0].tabId,created.tabId);
  const snap=await bridge.command("snapshot",{},owner);
  assert.equal(snap.tabId,created.tabId);
  assert.ok(snap.text.includes("Agent workspace"));
  await bridge.command("fill",{selector:"#note",text:"Agent filled silently"},owner);
  assert.equal(await agentPage.locator("#note").inputValue(),"Agent filled silently");
  assert.equal(await human.locator("#note").inputValue(),"");
  const nav=await bridge.command("click",{selector:"#details"},owner);
  assert.equal(nav.pending,true);
  await agentPage.waitForURL(website+"/agent/details",{timeout:15000});
  let navigationResult=null;
  for(let i=0;i<20;i++){
    navigationResult=bridge.result(nav.requestId,owner);
    if(navigationResult.done)break;
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  assert.equal(navigationResult?.ok,true,JSON.stringify(navigationResult));
  assert.equal(navigationResult.result.automatic,true);
  assert.equal(navigationResult.result.reason,"safe_same_origin_navigation");
  const save=await bridge.command("click",{selector:"#save"},owner);
  assert.equal(save.pending,true);
  await new Promise(resolve=>setTimeout(resolve,2200));
  assert.equal(bridge.result(save.requestId,owner).pending,true);
  const foreground=await popup.evaluate(()=>new Promise(resolve=>chrome.tabs.query({active:true,currentWindow:true},resolve)));
  assert.ok(foreground[0].url.endsWith("/human"),JSON.stringify(foreground.map(t=>t.url)));
  await bridge.command("agent_close_tab",{tabId:created.tabId},owner);
  assert.equal((await bridge.command("agent_tabs",{},owner)).tabs.length,0);
  assert.equal(await human.locator("h1").innerText(),"Human workspace");
  console.log(JSON.stringify({ok:true,paired:true,siteConsent:true,background:true,agentTabId:created.tabId,independentSnapshot:true,independentInput:true,humanForegroundPreserved:true,ownedCloseOnly:true}));
}finally{
  await browser?.close().catch(()=>{});
  await bridge?.close().catch(()=>{});
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:150}).catch(()=>{});
}
