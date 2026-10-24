import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {startChromeCompanionBroker} from "../connection-host/chrome-companion-broker.mjs";

const require=createRequire(import.meta.url);
const {chromium}=require("/Users/wahaha/node_modules/playwright");
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),"owl-companion-real-chrome-"));
const extension=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../chrome-companion");
let context,broker;
try{
  broker=await startChromeCompanionBroker({port:8794});
  context=await chromium.launchPersistentContext(path.join(scratch,"profile"),{
    headless:true,
    channel:"chromium",
    args:["--disable-extensions-except="+extension,"--load-extension="+extension],
    timeout:20_000,
  });
  let worker=context.serviceWorkers()[0];
  if(!worker)worker=await context.waitForEvent("serviceworker",{timeout:12000});
  assert.match(worker.url(),/^chrome-extension:\/\/[a-p]{32}\/service-worker\.mjs$/);
  const extensionId=new URL(worker.url()).host;
  const popup=await context.newPage();
  await popup.goto("chrome-extension://"+extensionId+"/popup.html",{waitUntil:"domcontentloaded",timeout:12000});
  await popup.locator("#code").fill(broker.pair("owl-workstream:real-chrome-test").code);
  await popup.locator("#pair").click();
  await popup.waitForFunction(()=>{
    const el=document.querySelector("#status");
    return el?.textContent?.includes("已连接 OWL");
  },undefined,{timeout:9000});
  assert.equal(broker.status("owl-workstream:real-chrome-test").connected,true);
  const status=await popup.locator("#status").innerText();
  console.log(JSON.stringify({ok:true,extensionInstalled:true,paired:true,extensionIdLength:extensionId.length,status:status.slice(0,100)}));
}finally{
  await context?.close().catch(()=>{});
  await broker?.close().catch(()=>{});
  await fs.rm(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:180}).catch(()=>{});
}
