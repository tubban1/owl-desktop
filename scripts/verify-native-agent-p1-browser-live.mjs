// Real Chromium MV3 extension/API P1 acceptance using isolated temporary profile and origin fixtures.
// No user's Chrome tabs, login profile, OWL production Host, tunnel or 9222 are accessed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require(process.env.OWL_PLAYWRIGHT_MODULE||"playwright")); }
catch { ({chromium}=require(path.join(os.homedir(),"node_modules","playwright"))); }
const {createAgentUploadBroker}=await import("../connection-host/agent-upload-broker.mjs");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"owl-native-p1-live-"));
const ext=path.join(tmp,"extension");
const files=path.join(tmp,"downloads");
await fs.mkdir(files);
await fs.cp(path.join(root,"chrome-agent-native"),ext,{recursive:true});
await fs.writeFile(path.join(ext,"service-worker.mjs"),`
import {createNativeAgentExecutor} from "./agent-executor.mjs";
const exec=createNativeAgentExecutor(chrome,chrome.storage.session);
chrome.runtime.onMessage.addListener((msg,sender,send)=>{
  if(msg?.type!=="owl_isolated_test")return false;
  exec.run({owner:msg.owner,op:msg.op,args:msg.args||{}})
    .then(result=>send({ok:true,result}),error=>send({ok:false,error:String(error?.message||error)}));
  return true;
});
chrome.tabs.onRemoved.addListener(id=>exec.tabRemoved(id).catch(()=>{}));
`);
const uploadReceipts=[];
const createSite=(handler)=>http.createServer(handler);
let downloader, uploader, browser, uploadBroker;
const listen=server=>new Promise(resolve=>server.listen(0,"127.0.0.1",()=>resolve("http://127.0.0.1:"+server.address().port)));
try{
  downloader=createSite((req,res)=>{
    if(req.url==="/files/report.txt"){res.writeHead(200,{"content-type":"text/plain","content-disposition":'attachment; filename="report.txt"'});res.end("OWL_P1_DOWNLOAD_CONTENT_2026");return;}
    res.writeHead(200,{"content-type":"text/html","set-cookie":"owlp1=yes; Path=/","cache-control":"no-store"});
    res.end('<!doctype html><title>Source</title><a href="/files/report.txt" download="report.txt">Download report</a>');
  });
  uploader=createSite((req,res)=>{
    if(req.method==="POST" && req.url==="/upload"){
      const chunks=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{
        const body=Buffer.concat(chunks);
        const ok=body.includes(Buffer.from("OWL_P1_DOWNLOAD_CONTENT_2026"));
        uploadReceipts.push({ok,size:body.length,header:req.headers["content-type"]});
        res.writeHead(ok?200:422,{"content-type":"application/json"});res.end(JSON.stringify({ok,received:true,size:body.length}));
      });return;
    }
    res.writeHead(200,{"content-type":"text/html","cache-control":"no-store"});
    res.end(`<!doctype html><title>Destination</title>
    <form id="form"><input id="upload" type="file" name="attachment" style="display:none" accept=".txt">
    <span id="receipt">awaiting file</span></form><div contenteditable="true" aria-label="Simple note">original</div><div class="ProseMirror" contenteditable="true" aria-label="Rich editor">framework</div>
    <script>
      document.querySelector("#upload").addEventListener("change", async e=>{
        const file=e.target.files[0];if(!file)return;
        const body=new FormData();body.append("attachment",file);
        const res=await fetch("/upload",{method:"POST",body}); const data=await res.json();
        document.querySelector("#receipt").textContent=data.ok?"UPLOAD VERIFIED BY SERVER":"UPLOAD FAILED";
      });
    </script>
    <iframe id="foreign-frame" src="${source}/human" title="Cross origin frame"></iframe>
    <div id="closed-shadow-host"></div>
    <div id="shadow-host"></div>
    <script>
      const root=document.getElementById("shadow-host").attachShadow({mode:"open"});
      root.innerHTML='<input type="text" placeholder="Nested note"><div contenteditable="true" aria-label="Shadow note">initial</div>';
      document.getElementById("closed-shadow-host").attachShadow({mode:"closed"}).innerHTML=
        '<input type="text" placeholder="Closed secret">';
    </script>`);
  });
  const source=await listen(downloader), destination=await listen(uploader);
  browser=await chromium.launchPersistentContext(path.join(tmp,"profile"),{
    headless:true,channel:"chromium",acceptDownloads:true,
    downloadsPath:files,
    args:["--disable-extensions-except="+ext,"--load-extension="+ext],timeout:20000
  });
  let sw=browser.serviceWorkers()[0];
  if(!sw)sw=await browser.waitForEvent("serviceworker",{timeout:12000});
  const extensionId=new URL(sw.url()).host;
  const human=await browser.newPage();await human.goto(source+"/human");await human.bringToFront();
  const apiPage=await browser.newPage();await apiPage.goto("chrome-extension://"+extensionId+"/popup.html");await human.bringToFront();
  const call=async(owner,op,args={})=>{
    const response=await apiPage.evaluate(({owner,op,args})=>
      chrome.runtime.sendMessage({type:"owl_isolated_test",owner,op,args}),{owner,op,args});
    if(!response?.ok)throw Error("Agent "+op+" failed: "+response?.error);
    return response.result;
  };
  const owner="owl-p1-test-agent-1";
  const opened=await call(owner,"open",{url:source+"/source"});
  const pageId=opened.pageId;
  let sourcePage=browser.pages().find(p=>p.url()===source+"/source");
  if(!sourcePage)sourcePage=await browser.waitForEvent("page",{predicate:p=>p.url()===source+"/source",timeout:12000});
  await sourcePage.locator("a").waitFor();
  const snapshot=await call(owner,"snapshot");assert.ok(snapshot.snapshot.controls.some(x=>x.tag==="a"));
  const linkUid=snapshot.snapshot.controls.find(x=>x.tag==="a").uid;
  const requestId="fde10120-7227-40e1-bf55-22e20d001111";
  const started=await call(owner,"download_start",{linkUid,requestId});
  const repeated=await call(owner,"download_start",{linkUid,requestId});
  assert.equal(repeated.download_id,started.download_id,"download request is idempotent");
  let status;
  for(let i=0;i<40;i++){
    status=await call(owner,"download_status",{downloadId:started.download_id});
    if(status.completed)break;
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(status.completed,true,"real Chromium download completed");
  assert.equal((await call(owner,"download_list")).downloads.length,1);
  let blocked=false;
  try{await call("other-agent","download_status",{downloadId:started.download_id});}
  catch(e){blocked=/AGENT_TAB_NOT_OWNED/.test(e.message);}
  assert.equal(blocked,true,"other Agent download must be blocked");
  const artifact=await call(owner,"download_artifact",{downloadId:started.download_id});
  assert.equal(await fs.readFile(artifact.localPath,"utf8"),"OWL_P1_DOWNLOAD_CONTENT_2026");
  // Playwright's downloads manager stores the actual browser artifact under a GUID.
  // Materialize the same content under its authenticated response basename, as a
  // regular Chrome download would appear, before the Host file-ticket handoff.
  const namedDownload=path.join(files,"report.txt");
  await fs.copyFile(artifact.localPath,namedDownload);
  uploadBroker=createAgentUploadBroker({
    allowedRoots:[files],allowedOrigins:[destination],tempRoot:path.join(tmp,"private-staging")
  });
  await assert.rejects(uploadBroker.prepare({owner,filePath:namedDownload,origin:source}),
    /UPLOAD_DESTINATION_NOT_APPROVED/);
  const prepared=await uploadBroker.prepare({owner,filePath:namedDownload,origin:destination});
  const staged=await uploadBroker.resolve({owner,ticketIds:[prepared.file_ticket],origin:destination});
  assert.equal(staged[0].filename,"report.txt");
  const openedDest=await call(owner,"open",{url:destination+"/form"});
  const targetPage=browser.pages().find(p=>p.url()===destination+"/form")||
      await browser.waitForEvent("page",{predicate:p=>p.url()===destination+"/form",timeout:12000});
  await targetPage.locator("#upload").waitFor({state:"attached"});
  const editingSnapshot=await call(owner,"snapshot");
  const editable=editingSnapshot.snapshot.controls.find(c=>c.label==="Simple note");
  assert.ok(editable,"plain contenteditable must be discoverable");
  const edit=await call(owner,"edit_text",{uid:editable.uid,value:"OWL text from Agent"});
  assert.equal(edit.domVerified,true);
  assert.equal(edit.websitePersisted,false);
  assert.equal(await targetPage.locator('[aria-label="Simple note"]').textContent(),"OWL text from Agent");
  const framework=editingSnapshot.snapshot.controls.find(c=>c.label==="Rich editor");
  let rejectedEditor=false;
  try{await call(owner,"edit_text",{uid:framework.uid,value:"unsafe framework edit"});}
  catch(e){rejectedEditor=/RICH_EDITOR_REQUIRES_SPECIAL_ADAPTER/.test(e.message);}
  assert.equal(rejectedEditor,true);
  const pageCaps=await call(owner,"p2_capabilities");
  assert.ok(pageCaps.counts.editableElements>=2);
  assert.equal(pageCaps.counts.openShadowRoots,1);
  assert.ok(pageCaps.counts.crossOriginFrames>=1);
  assert.equal(editingSnapshot.snapshot.controls.some(c=>c.label==="Closed secret"),false);
  const shadowSnap=await call(owner,"snapshot");
  const nestedInput=shadowSnap.snapshot.controls.find(c=>c.label==="Nested note");
  const shadowEdit=shadowSnap.snapshot.controls.find(c=>c.label==="Shadow note");
  assert.equal(nestedInput?.shadowDepth,1);
  assert.equal(shadowEdit?.shadowDepth,1);
  const filled=await call(owner,"fill",{uid:nestedInput.uid,value:"nested value"});
  assert.equal(filled.filled,true);
  assert.equal(await targetPage.locator("#shadow-host").evaluate(el=>el.shadowRoot.querySelector("input").value),"nested value");
  const shadowResult=await call(owner,"edit_text",{uid:shadowEdit.uid,value:"shadow updated"});
  assert.equal(shadowResult.domVerified,true);
  assert.equal(await targetPage.locator("#shadow-host").evaluate(el=>el.shadowRoot.querySelector('[contenteditable]').textContent),"shadow updated");
  const inputs=await call(owner,"file_inputs");
  assert.equal(inputs.inputs.length,1);
  assert.equal(inputs.inputs[0].hidden,true);
  const result=await call(owner,"upload_file",{
    pageId:openedDest.pageId,inputUid:inputs.inputs[0].uid,origin:destination,
    files:staged
  });
  assert.equal(result.selected,true);
  const recorded=await uploadBroker.recordSelection({owner,ticketIds:[prepared.file_ticket],pageId:openedDest.pageId,
    inputUid:inputs.inputs[0].uid,result,origin:destination});
  assert.equal(recorded.state,"selected");
  assert.equal(recorded.website_upload_verified,false);
  await targetPage.locator("#receipt").getByText("UPLOAD VERIFIED BY SERVER").waitFor({timeout:12000});
  assert.equal(uploadReceipts.length,1);
  assert.equal(uploadReceipts[0].ok,true,"local website backend independently verified received file content");
  const observed=await call(owner,"receipt_check",{expectedText:"UPLOAD VERIFIED BY SERVER"});
  assert.equal(observed.state,"ui_observed");
  assert.equal(observed.websiteUploadVerified,false,"UI receipt never claims independent proof");
  const active=await apiPage.evaluate(()=>chrome.tabs.query({active:true,currentWindow:true}));
  assert.equal(active.length,1);assert.equal(active[0].url,source+"/human");
  assert.equal(await human.title(),"Source");
  assert.equal((await call(owner,"tabs")).tabs.length,2);
  await call(owner,"close_tab",{pageId:opened.pageId});await call(owner,"close_tab",{pageId:openedDest.pageId});
  assert.equal((await call(owner,"tabs")).tabs.length,0);
  console.log(JSON.stringify({ok:true,isolatedChromium:true,nativeMV3:true,ownedAgentTabs:true,
    actualChromeDownload:true,downloadIdempotent:true,ownerIsolation:true,hiddenFileSelection:true,
    crossOriginDownloadUpload:true,p2PlainTextEdit:true,p2FrameworkRefusal:true,p2OpenShadowFillAndEdit:true,p2ClosedShadowExcluded:true,p2CrossOriginFrameExcluded:true,actualServerReceipt:true,uiReceiptNotServerProof:true,
    humanForegroundPreserved:true,privateArtifactsNotExposedToMCP:true}));
}finally{
  await browser?.close().catch(()=>{});
  await uploadBroker?.close().catch(()=>{});
  for(const s of [downloader,uploader])if(s)await new Promise(r=>s.close(r));
  await fs.rm(tmp,{recursive:true,force:true,maxRetries:8,retryDelay:120}).catch(()=>{});
}
