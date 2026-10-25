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
    <textarea id="paste" aria-label="Paste notes"></textarea>
    <input id="password" type="password" aria-label="Password">
    <div id="drag-item" draggable="true" aria-label="Draft card">Card</div>
    <div id="dropzone" data-dropzone="true" aria-label="Board slot">Empty</div>
    <div id="no-drop" data-dropzone="true" aria-label="Inert slot">Empty</div>
    <button type="button" aria-label="Expand details" id="safe-click">Expand details</button>
    <button type="button" aria-label="Delete account" id="danger-click">Delete account</button>
    <button type="button" aria-label="Open panel" id="indirect-trigger">Open panel</button>
    <button type="button" aria-label="Upload file" id="picker-trigger">Upload file</button>
    <button type="submit" aria-label="Proceed" id="submit-trigger">Proceed</button>
    <p id="cursor-click-receipt">not clicked</p>
    <div id="file-drop" data-dropzone="true" aria-label="File drop target" style="height:80px;width:280px;border:1px solid gray">DROP FILE HERE</div>
    <form id="form"><input id="upload" type="file" name="attachment" style="display:none" accept=".txt">
    <span id="receipt">awaiting file</span></form><input type="file" style="display:none" id="indirect-file"><div contenteditable="true" aria-label="Simple note">original</div><div class="ProseMirror" contenteditable="true" aria-label="Rich editor">framework</div>
    <script>
      document.querySelector("#indirect-trigger").addEventListener("click",()=>{
        document.querySelector("#indirect-file").click();
      });
      document.querySelector("#safe-click").addEventListener("click",e=>{
        document.querySelector("#cursor-click-receipt").textContent=
          e.isTrusted?"TRUSTED TAB CLICK":"UNTRUSTED CLICK";
      });
      document.querySelector(".ProseMirror").addEventListener("input",e=>{
        e.currentTarget.dataset.modelText=e.currentTarget.textContent;
        e.currentTarget.dataset.trustedInput=String(e.isTrusted);
      });
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
      document.querySelector("#dropzone").addEventListener("dragover",e=>e.preventDefault());
      document.querySelector("#dropzone").addEventListener("drop",e=>{
        e.preventDefault();document.querySelector("#dropzone").textContent="Received: "+e.dataTransfer.getData("text/plain");
      });
      document.querySelector("#file-drop").addEventListener("dragover",e=>e.preventDefault());
      document.querySelector("#file-drop").addEventListener("drop",async e=>{
        e.preventDefault();const file=e.dataTransfer.files[0];if(!file)return;
        const data=new FormData();data.append("attachment",file);
        const response=await fetch("/upload",{method:"POST",body:data});const receipt=await response.json();
        document.querySelector("#file-drop").textContent=receipt.ok?"FILE DROP SERVER VERIFIED":"FILE DROP FAILED";
      });
      document.getElementById("closed-shadow-host").attachShadow({mode:"closed"}).innerHTML=
        '<input type="text" placeholder="Closed secret">';
    </script>`);
  });
  const source=await listen(downloader), destination=await listen(uploader);
  browser=await chromium.launchPersistentContext(path.join(tmp,"profile"),{
    headless:true,channel:process.env.OWL_CHROME_CHANNEL||"chromium",acceptDownloads:true,
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
  const rich=await call(owner,"rich_editor_insert",{uid:framework.uid,value:"Controlled framework text"});
  assert.equal(rich.domVerified,true);assert.equal(rich.systemKeyboardUsed,false);
  assert.equal(await targetPage.locator(".ProseMirror").textContent(),"Controlled framework text");
  assert.equal(await targetPage.locator(".ProseMirror").getAttribute("data-model-text"),"Controlled framework text");
  assert.equal(await targetPage.locator(".ProseMirror").getAttribute("data-trusted-input"),"true");
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
  const interactionSnapshot=await call(owner,"snapshot");
  const uid=label=>interactionSnapshot.snapshot.controls.find(c=>c.label===label)?.uid;
  assert.ok(uid("Paste notes")&&uid("Password")&&uid("Draft card")&&uid("Board slot")&&uid("Inert slot"));
  const paste=await call(owner,"paste_text",{uid:uid("Paste notes"),text:"OWL P2 pasted text"});
  assert.equal(paste.domVerified,true);assert.equal(paste.systemClipboardTouched,false);
  assert.equal(await targetPage.locator("#paste").inputValue(),"OWL P2 pasted text");
  let sensitiveDenied=false;
  try{await call(owner,"paste_text",{uid:uid("Password"),text:"not-allowed"});}
  catch(e){sensitiveDenied=/SENSITIVE_OR_INVALID_FIELD/.test(e.message);}
  assert.equal(sensitiveDenied,true);
  assert.equal(await targetPage.locator("#password").inputValue(),"");
  let foreignDenied=false;
  try{await call("foreign-agent","drag_drop",{sourceUid:uid("Draft card"),targetUid:uid("Board slot")});}
  catch(e){foreignDenied=/AGENT_TAB_NOT_OWNED/.test(e.message);}
  assert.equal(foreignDenied,true);
  let noEffectDenied=false;
  try{await call(owner,"drag_drop",{sourceUid:uid("Draft card"),targetUid:uid("Inert slot")});}
  catch(e){noEffectDenied=/DROP_EFFECT_NOT_OBSERVED/.test(e.message);}
  assert.equal(noEffectDenied,true);
  const drag=await call(owner,"drag_drop",{sourceUid:uid("Draft card"),targetUid:uid("Board slot")});
  assert.equal(drag.domVerified,true);assert.equal(drag.fileTransferred,false);
  assert.match(await targetPage.locator("#dropzone").textContent(),/Received:/);
  const inputs=await call(owner,"file_inputs");
  assert.equal(inputs.inputs.length,2);
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
  const cursorSnapshot=await call(owner,"snapshot");
  const cursorUid=label=>cursorSnapshot.snapshot.controls.find(x=>x.label===label)?.uid;
  assert.ok(cursorUid("Expand details")&&cursorUid("Delete account")&&cursorUid("Upload file")&&cursorUid("Open panel"));
  const moved=await call(owner,"cursor_move",{uid:cursorUid("Expand details")});
  assert.equal(moved.moved,true);
  assert.equal(moved.osPointerMoved,false);
  assert.equal(moved.foregroundUnchanged,true);
  assert.equal(await targetPage.locator('[data-owl-lab-agent-cursor-host="true"]').count(),1);
  for(const label of ["Delete account","Upload file","Proceed"]){
    let blocked=false;
    try{await call(owner,"cursor_click",{uid:cursorUid(label)});}
    catch(e){blocked=/CURSOR_ACTION_REQUIRES_HUMAN/.test(e.message);}
    assert.equal(blocked,true,"consequential click must be human-owned: "+label);
  }
  let indirectFileChooserBlocked=false;
  try{await call(owner,"cursor_click",{uid:cursorUid("Open panel")});}
  catch(e){indirectFileChooserBlocked=/CURSOR_NATIVE_PICKER_INTERCEPTED/.test(e.message);}
  assert.equal(indirectFileChooserBlocked,true,"indirect JS-triggered file picker intercepted inside tab");
  let foreignCursorBlocked=false;
  try{await call("other-owner","cursor_click",{uid:cursorUid("Expand details")});}
  catch(e){foreignCursorBlocked=/AGENT_TAB_NOT_OWNED/.test(e.message);}
  assert.equal(foreignCursorBlocked,true);
  const clicked=await call(owner,"cursor_click",{uid:cursorUid("Expand details")});
  assert.equal(clicked.clicked,true);
  assert.equal(clicked.websitePersisted,false);
  assert.equal(clicked.osPointerMoved,false);
  assert.equal(await targetPage.locator("#cursor-click-receipt").textContent(),"TRUSTED TAB CLICK");
  const defaultClick=await call(owner,"click",{uid:cursorUid("Expand details")});
  assert.equal(defaultClick.clicked,true,"legacy browser_agent_click routes to trusted tab cursor");
  assert.equal(defaultClick.inputMethod,"tab_scoped_chrome_debugger");
  assert.equal((await apiPage.evaluate(()=>chrome.tabs.query({active:true,currentWindow:true})))[0].url,source+"/human");
  // Agent must yield immediately when the human foregrounds their Agent-created tab.
  await targetPage.bringToFront();
  let foregroundDenied=false;
  try{await call(owner,"cursor_click",{uid:cursorUid("Expand details")});}
  catch(e){foregroundDenied=/AGENT_TAB_FOREGROUND_NEEDS_HUMAN/.test(e.message);}
  assert.equal(foregroundDenied,true,"human-foreground Agent tab cannot be auto-clicked");
  await human.bringToFront();
  // An overlapping element appearing after the snapshot must invalidate clicks.
  await targetPage.evaluate(()=>{
    const r=document.querySelector("#safe-click").getBoundingClientRect();
    const overlay=document.createElement("div");
    overlay.id="owl-test-occluder";
    Object.assign(overlay.style,{position:"fixed",left:r.left+"px",top:r.top+"px",
      width:r.width+"px",height:r.height+"px",zIndex:"99999",background:"#999"});
    document.documentElement.append(overlay);
  });
  let occludedDenied=false;
  try{await call(owner,"cursor_click",{uid:cursorUid("Expand details")});}
  catch(e){occludedDenied=/CURSOR_TARGET_OCCLUDED/.test(e.message);}
  assert.equal(occludedDenied,true,"covered controls cannot receive blind clicks");
  await targetPage.evaluate(()=>document.querySelector("#owl-test-occluder").remove());
  const hidden=await call(owner,"cursor_hide");
  assert.equal(hidden.visible,false);
  assert.equal(await targetPage.locator('[data-owl-lab-agent-cursor-host="true"]').count(),0);
  const fileDropSnapshot=await call(owner,"snapshot");
  const dropUid=fileDropSnapshot.snapshot.controls.find(x=>x.label==="File drop target")?.uid;
  assert.ok(dropUid,"file drop target must exist in Agent snapshot");
  const preparedDrop=await uploadBroker.prepare({owner,filePath:namedDownload,origin:destination});
  const filesForDrop=await uploadBroker.resolve({owner,ticketIds:[preparedDrop.file_ticket],origin:destination});
  let foreignDropRejected=false;
  try{await call("foreign-owner","drop_files",{pageId:openedDest.pageId,targetUid:dropUid,origin:destination,files:filesForDrop});}
  catch(e){foreignDropRejected=/AGENT_TAB_NOT_OWNED/.test(e.message);}
  assert.equal(foreignDropRejected,true);
  const dropped=await call(owner,"drop_files",{pageId:openedDest.pageId,targetUid:dropUid,origin:destination,files:filesForDrop});
  assert.equal(dropped.dispatched,true);
  assert.equal(dropped.websiteUploadVerified,false);
  const savedDrop=await uploadBroker.recordDrop({owner,ticketIds:[preparedDrop.file_ticket],pageId:openedDest.pageId,targetUid:dropUid,result:dropped,origin:destination});
  assert.equal(savedDrop.website_upload_verified,false);
  await assert.rejects(uploadBroker.resolve({owner,ticketIds:[preparedDrop.file_ticket],origin:destination}),
    /UPLOAD_TICKET_NOT_AUTHORIZED/);
  await targetPage.locator("#file-drop").getByText("FILE DROP SERVER VERIFIED").waitFor({timeout:12000});
  assert.equal(uploadReceipts.length,2);
  assert.equal(uploadReceipts[1].ok,true,"real Chromium file drop reached independent backend");
  const active=await apiPage.evaluate(()=>chrome.tabs.query({active:true,currentWindow:true}));
  assert.equal(active.length,1);assert.equal(active[0].url,source+"/human");
  assert.equal(await human.title(),"Source");
  assert.equal((await call(owner,"tabs")).tabs.length,2);
  await call(owner,"close_tab",{pageId:opened.pageId});await call(owner,"close_tab",{pageId:openedDest.pageId});
  assert.equal((await call(owner,"tabs")).tabs.length,0);
  console.log(JSON.stringify({ok:true,isolatedChromium:true,nativeMV3:true,ownedAgentTabs:true,
    actualChromeDownload:true,downloadIdempotent:true,ownerIsolation:true,hiddenFileSelection:true,
    crossOriginDownloadUpload:true,p2PlainTextEdit:true,p2FrameworkRefusal:true,p2TrustedFrameworkInsert:true,p3VirtualCursor:true,p3TrustedTabClick:true,p3DefaultClickUpgraded:true,p3SensitiveClickDenied:true,p3ForegroundYield:true,p3OcclusionGuard:true,p3NativeFileChooserIntercept:true,p3SystemPointerUnchanged:true,p2OpenShadowFillAndEdit:true,p2ClosedShadowExcluded:true,p2CrossOriginFrameExcluded:true,p2TextPaste:true,p2DragDrop:true,p2DeniedSensitiveAndInert:true,p2FileDropWithTicket:true,p2FileDropServerReceipt:true,actualServerReceipt:true,uiReceiptNotServerProof:true,
    humanForegroundPreserved:true,privateArtifactsNotExposedToMCP:true}));
}finally{
  await browser?.close().catch(()=>{});
  await uploadBroker?.close().catch(()=>{});
  for(const s of [downloader,uploader])if(s)await new Promise(r=>s.close(r));
  await fs.rm(tmp,{recursive:true,force:true,maxRetries:8,retryDelay:120}).catch(()=>{});
}
