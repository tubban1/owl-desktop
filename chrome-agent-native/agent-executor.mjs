import {discoverFileInputs,verifyFileInput,readFileInputSelection} from "./file-inputs.mjs";
// CDP accepts both POSIX and Windows drive-absolute file paths. The Native
// Host supplies these paths only after owner/root/origin authorization.
export function isNativeAbsoluteStagePath(value) {
  return typeof value==="string" && !value.includes("\0") &&
    (value.startsWith("/") || /^[A-Za-z]:\\[^\\]+/.test(value));
}

import {createAgentDownloadWorkflow,detectPageReceipt} from "./download-workflow.mjs";
import {inspectP2Capabilities} from "./p2-capabilities.mjs";
import {pastePlainText,dragDropWithinPage} from "./p2-interactions.mjs";
import {locateAgentFileDropZone,checkAgentFileDropZone} from "./file-drop-zone.mjs";
import {prepareAgentRichEditor,checkAgentRichEditor} from "./rich-editor.mjs";
import {locateVirtualCursorTarget,showVirtualCursor,hideVirtualCursor} from "./virtual-cursor.mjs";
import {executeFormAction} from "./form-controls.mjs";
import {prepareTrustedTextField,checkTrustedTextField} from "./trusted-text-field.mjs";

// An explicit Agent open(url) can reuse an already-open INACTIVE tab with
// the exact same URL (including path, query and fragment). Adoption grants
// only the requesting Agent Session access to that tab, not other user tabs.
// Created tabs may be closed; adopted human tabs must be preserved on release.
// The store is chrome.storage.session and survives service-worker suspension.
const MAX_TABS_PER_OWNER=12;
const urlOrigin=url=>{
  try{const u=new URL(url);return ["http:","https:"].includes(u.protocol)?u.origin:null;}
  catch{return null;}
};
export function createNativeAgentExecutor(chrome,storage){
  const downloads=createAgentDownloadWorkflow(chrome,storage);
  const instanceId=globalThis.crypto?.randomUUID?.()||
    ("agent-worker-"+Date.now()+"-"+Math.random().toString(36).slice(2));
  const persistent=chrome.storage?.local;
  const reloadStateKey="owlNativeReloadCheckpoint";
  let restored=false;
  async function restoreAfterReload(){
    if(restored)return;
    restored=true;
    if(!persistent)return;
    const checkpoint=(await persistent.get(reloadStateKey))[reloadStateKey];
    if(!checkpoint)return;
    // One-use, bounded checkpoint. Never leave ownership grants in durable
    // local storage after restoration, and never trust unrelated stale tabs.
    await persistent.remove(reloadStateKey);
    if(!checkpoint||checkpoint.version!==1||
       !Number.isFinite(checkpoint.expiresAt)||checkpoint.expiresAt<Date.now()||
       checkpoint.expiresAt>Date.now()+120_000||
       !checkpoint.owned||typeof checkpoint.owned!=="object")return;
    const active=(await storage.get("owlNativeOwned")).owlNativeOwned;
    if(active&&Object.keys(active).length)return;
    const owned={},selected={};
    for(const [key,binding] of Object.entries(checkpoint.owned).slice(0,120)){
      const id=Number(key);
      if(!Number.isSafeInteger(id)||id<0||!binding||
         typeof binding.owner!=="string"||binding.owner.length<2||
         binding.owner.length>240)continue;
      try{
        const tab=await chrome.tabs.get(id);
        if(binding.adopted&&urlOrigin(tab.url)!==binding.origin)continue;
        if(!urlOrigin(tab.url)||tab.incognito)continue;
        owned[id]=binding;
      }catch{}
    }
    for(const [owner,id] of Object.entries(checkpoint.selected||{})){
      if(owned[id]?.owner===owner)selected[owner]=id;
    }
    await storage.set({owlNativeOwned:owned,owlNativeSelected:selected});
  }
  const read=async()=>{
    await restoreAfterReload();
    return {owned:(await storage.get("owlNativeOwned")).owlNativeOwned||{},
      selected:(await storage.get("owlNativeSelected")).owlNativeSelected||{}};
  };
  const save=async s=>storage.set({owlNativeOwned:s.owned,owlNativeSelected:s.selected});
  async function current(owner,args={},requireSelected=true){
    const state=await read();
    const tabId=args.tabId??state.selected[owner];
    if(!Number.isInteger(tabId)||state.owned[tabId]?.owner!==owner)
      throw Error("AGENT_TAB_NOT_OWNED");
    let tab;
    try{tab=await chrome.tabs.get(tabId);}
    catch{delete state.owned[tabId];if(state.selected[owner]===tabId)delete state.selected[owner];await save(state);throw Error("AGENT_TAB_CLOSED");}
    const binding=state.owned[tabId];
    // A human-owned tab can later navigate somewhere unrelated. Re-check its
    // origin on every action rather than silently extending the adoption.
    if(binding.adopted && urlOrigin(tab.url)!==binding.origin &&
       args.allowOriginChanged!==true)throw Error("AGENT_REUSED_TAB_ORIGIN_CHANGED");
    return {state,tab,tabId};
  }
  async function inject(tabId,func,args=[]){
    const result=await chrome.scripting.executeScript({target:{tabId},func,args});
    // Chrome may return an undefined result when a page-injected function throws.
    // Fail closed instead of reporting a pageId-only phantom success.
    if(result?.[0]?.result===undefined)throw Error("BROWSER_PAGE_EXECUTION_FAILED");
    return result[0].result;
  }
  function inspect(){
    const visible=e=>{
      const s=getComputedStyle(e),r=e.getBoundingClientRect();
      return s.visibility!=="hidden"&&s.display!=="none"&&r.width>0&&r.height>0;
    };
    // Inspect only this Agent-owned document and its *open* shadow roots.
    // Cross-origin frames and closed roots remain out of scope; no OS focus.
    const nodes=[];
    const collect=(root,depth)=>{
      if(depth>8 || nodes.length>=120)return;
      for(const el of root.querySelectorAll("*")){
        if(el.matches("a,button,input,textarea,select,[role=button],[role=textbox],[role=combobox],[contenteditable]:not([contenteditable=false]),[draggable=true],[data-dropzone]") &&
           visible(el))nodes.push({el,shadowDepth:depth});
        if(nodes.length>=120)break;
        if(el.shadowRoot)collect(el.shadowRoot,depth+1);
      }
    };
    collect(document,0);
    const controls=nodes.slice(0,120).map(({el,shadowDepth},i)=>{
      const key="owl-agent-"+i;
      el.setAttribute("data-owl-agent-control",key);
      return {uid:key,tag:el.tagName.toLowerCase(),type:el.getAttribute("type")||"",
        role:el.getAttribute("role")||"",
        editable:!!el.isContentEditable,
        label:(el.getAttribute("aria-label")||el.getAttribute("placeholder")||
        el.getAttribute("data-placeholder")||el.getAttribute("name")||
        el.textContent||"").trim().slice(0,125),
        shadowDepth,href:el.tagName==="A"?el.href:undefined};
    });
    return {title:document.title,url:location.href,text:(document.body?.innerText||"").slice(0,10000),controls};
  }
  function operate(uid,value,op){
    const selector='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
    const find=(root,depth=0)=>{
      if(depth>8)return null;
      const hit=root.querySelector(selector);
      if(hit)return hit;
      for(const host of root.querySelectorAll("*")){
        if(host.shadowRoot){const nested=find(host.shadowRoot,depth+1);if(nested)return nested;}
      }
      return null;
    };
    const el=find(document);
    if(!el)throw Error("AGENT_SNAPSHOT_STALE");
    const label=(el.getAttribute("aria-label")||el.textContent||el.getAttribute("name")||"").trim();
    const danger=/delete|destroy|logout|sign.?out|purchase|payment|pay now|checkout|unsubscribe|remove account|erase|security settings|disable account|删除|注销|付款/i;
    if(danger.test(label))throw Error("CONSEQUENTIAL_ACTION_REQUIRES_HUMAN");
    if(op==="fill"){
      const tag=el.tagName.toLowerCase(),type=(el.getAttribute("type")||"text").toLowerCase();
      const auto=(el.getAttribute("autocomplete")||"").toLowerCase();
      if(!["input","textarea"].includes(tag)||!["text","search","url","email","tel"].includes(type)||
        /password|cc-|one.time|otp|token|secret|passkey/i.test(label+" "+auto)||
        el.disabled||el.readOnly)throw Error("SENSITIVE_OR_INVALID_FIELD");
      const proto=tag==="textarea"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,"value").set.call(el,value);
      el.dispatchEvent(new Event("input",{bubbles:true}));
      el.dispatchEvent(new Event("change",{bubbles:true}));
      return {filled:true,uid,length:value.length};
    }
    if(op==="edit_text"){
      // DOM-only plain contenteditable; never claim the website's editor state persisted.
      if(!el.isContentEditable || el.matches("[aria-readonly=true],[contenteditable=false]") ||
         el.closest(".ProseMirror,.ql-editor,.tiptap,[data-slate-editor],[data-lexical-editor]"))
        return {error:"RICH_EDITOR_REQUIRES_SPECIAL_ADAPTER"};
      if(/password|cc-|one.time|otp|token|secret|passkey/i.test(
         label+" "+(el.getAttribute("autocomplete")||"")))
        throw Error("SENSITIVE_OR_INVALID_FIELD");
      const ev=new InputEvent("beforeinput",{bubbles:true,cancelable:true,inputType:"insertReplacementText",data:value});
      if(!el.dispatchEvent(ev))return {error:"EDITOR_BEFOREINPUT_REJECTED"};
      el.replaceChildren(document.createTextNode(value)); // text, never HTML
      el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertReplacementText",data:value}));
      if(el.textContent!==value)return {error:"EDITOR_DOM_POSTCONDITION_FAILED"};
      return {edited:true,uid,length:value.length,domVerified:true,websitePersisted:false};
    }
    throw Error("UNKNOWN_PAGE_OPERATION");
  }
  async function run({owner,op,args={}}){
    if(typeof owner!=="string"||owner.length<2||owner.length>240)throw Error("NATIVE_OWNER_INVALID");
    if(op==="extension_info"){
      await restoreAfterReload();
      return {
      instanceId,version:chrome.runtime?.getManifest?.().version||"unknown",
      selfReloadProtocol:1,source:"owl-native-chrome",canSelfReload:true};
    }
    if(op==="extension_prepare_reload"){
      if(!persistent)throw Error("EXTENSION_PERSISTENT_CHECKPOINT_UNAVAILABLE");
      if(typeof args?.expectedVersion!=="string"||args.expectedVersion.length>32||
         !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(args.expectedVersion))
        throw Error("EXTENSION_EXPECTED_VERSION_INVALID");
      const currentVersion=chrome.runtime?.getManifest?.().version||"unknown";
      const rateKey="owlNativeExtensionReloadAt";
      const last=(await persistent.get(rateKey))[rateKey];
      if(typeof last==="number"&&last>Date.now()-20_000&&last<=Date.now())
        throw Error("EXTENSION_RELOAD_RATE_LIMITED");
      const state=await read();
      // Explicit version pin prevents silently installing unintended or
      // partially copied extension code. The new worker will prove version.
      await persistent.set({
        [rateKey]:Date.now(),
        [reloadStateKey]:{
          version:1,expiresAt:Date.now()+90_000,
          owned:state.owned,selected:state.selected
        }
      });
      return {reloadPrepared:true,previousInstanceId:instanceId,
        currentVersion,expectedVersion:args.expectedVersion,
        ownerTabsPreserved:Object.keys(state.owned).length};
    }
    if(op==="open"){
      const url=args.url;
      if(typeof url!=="string"||url.length>2048||!urlOrigin(url))throw Error("NATIVE_URL_INVALID");
      const state=await read();
      const targetUrl=new URL(url).href;
      // No wildcard/site-only matching: never hijack an unrelated page,
      // including pages with different query strings, accounts or paths.
      const visibleTabs=await chrome.tabs.query({});
      const eligible=visibleTabs.filter(tab=>Number.isInteger(tab.id) &&
        !tab.incognito && !tab.pinned && urlOrigin(tab.url) &&
        new URL(tab.url).href===targetUrl);
      // Inactive first, regardless of whether this Session already owns it.
      // Do not adopt a foreground human tab solely because its URL matches.
      // A previously owned foreground tab can still be reused and operated.
      const reusable=eligible.find(tab=>tab.active===false &&
        (!state.owned[tab.id] || state.owned[tab.id].owner===owner)) ||
        eligible.find(tab=>state.owned[tab.id]?.owner===owner);
      if(reusable){
        const adopted=!state.owned[reusable.id];
        if(adopted && Object.values(state.owned).filter(x=>x.owner===owner).length>=MAX_TABS_PER_OWNER)
          throw Error("OWNER_TAB_LIMIT");
        if(adopted)state.owned[reusable.id]={owner,adopted:true,origin:urlOrigin(url),
          initialUrl:targetUrl,createdAt:Date.now()};
        state.selected[owner]=reusable.id;
        await save(state);
        return {pageId:reusable.id,tabId:reusable.id,url:reusable.url,
          background:reusable.active===false,usesExistingChromeProfile:true,
          reusedExistingTab:true,tabCreated:false,adoptedHumanTab:adopted};
      }
      if(Object.values(state.owned).filter(x=>x.owner===owner).length>=MAX_TABS_PER_OWNER)
        throw Error("OWNER_TAB_LIMIT");
      const tab=await chrome.tabs.create({url,active:false});
      state.owned[tab.id]={owner,createdAt:Date.now(),adopted:false};
      state.selected[owner]=tab.id;await save(state);
      return {pageId:tab.id,tabId:tab.id,url,background:true,
        usesExistingChromeProfile:true,reusedExistingTab:false,tabCreated:true};
    }
    if(op==="tabs"){
      const s=await read(),tabs=[];
      for(const [key,value] of Object.entries(s.owned)){
        if(value.owner!==owner)continue;
        try{
          const tab=await chrome.tabs.get(Number(key));
          if(value.adopted && urlOrigin(tab.url)!==value.origin)continue;
          tabs.push({pageId:tab.id,url:tab.url,selected:s.selected[owner]===tab.id,
            adoptedHumanTab:!!value.adopted,background:tab.active===false});
        }catch{}
      }
      return {tabs};
    }
    if(op==="use"){
      const {state,tabId}=await current(owner,{tabId:args.pageId});
      state.selected[owner]=tabId;await save(state);
      return {pageId:tabId,selected:true,foregroundUnchanged:true};
    }
    if(op==="status")return {ready:true,transport:"native-messaging"};
    if(op==="close_tab"&&!Number.isInteger(args.pageId))throw Error("AGENT_TAB_ID_REQUIRED");
    const {state,tab,tabId}=await current(owner,op==="close_tab"?
      {tabId:args.pageId,allowOriginChanged:true}:{});
    if(op==="download_start"){
      if(typeof args.linkUid!=="string"||args.linkUid.length>120)
        throw Error("DOWNLOAD_LINK_UID_INVALID");
      return downloads.start(owner,tab,args,inject);
    }
    if(op==="download_status")return downloads.state(owner,args.downloadId);
    if(op==="download_cancel")return downloads.cancel(owner,args.downloadId);
    if(op==="download_list")return downloads.list(owner);
    if(op==="download_artifact"){
      // Only the trusted local Host consumes localPath; never return this
      // operation as an Agent-facing MCP tool.
      return downloads.state(owner,args.downloadId,{includePath:true});
    }
    if(op==="form_controls"){
      const origin=urlOrigin(tab.url);
      if(!origin)throw Error("FORM_ORIGIN_INVALID");
      return {pageId:tabId,...await inject(tabId,executeFormAction,["inspect",{origin}])};
    }
    if(op==="form_set"){
      const origin=urlOrigin(tab.url);
      if(!origin||typeof args.uid!=="string"||!/^owl-agent-\d{1,3}$/.test(args.uid))
        throw Error("FORM_FIELD_INVALID");
      const response=await inject(tabId,executeFormAction,["set",{uid:args.uid,origin,change:args.change}]);
      if(response?.error)throw Error(response.error);
      return {pageId:tabId,...response};
    }
    if(op==="form_review"){
      if(typeof args.pageUrl!=="string"||args.pageUrl!==tab.url||
         !/^owl-agent-\d{1,3}$/.test(args.submitUid||""))
        throw Error("FORM_REVIEW_PAGE_OR_CONTROL_MISMATCH");
      return {pageId:tabId,...await inject(tabId,executeFormAction,
        ["review",{origin:urlOrigin(tab.url),pageUrl:args.pageUrl,submitUid:args.submitUid}])};
    }
    if(op==="form_submit"){
      if(typeof args.pageUrl!=="string"||args.pageUrl!==tab.url||
         !/^owl-agent-\d{1,3}$/.test(args.submitUid||""))
        throw Error("FORM_SUBMIT_PAGE_OR_CONTROL_MISMATCH");
      const response=await inject(tabId,executeFormAction,["submit",{origin:urlOrigin(tab.url),
        pageUrl:args.pageUrl,submitUid:args.submitUid,salary:args.salary,
        referralValue:args.referralValue,notice:args.notice}]);
      if(response?.error)throw Error(response.error);
      return {pageId:tabId,...response};
    }
    if(op==="receipt_check"){
      if(typeof args.expectedText!=="string"||args.expectedText.length<3||
         args.expectedText.length>160)throw Error("RECEIPT_TEXT_INVALID");
      const origin=new URL(tab.url).origin;
      const check=await inject(tabId,detectPageReceipt,[args.expectedText,origin]);
      return {pageId:tabId,state:check?.observed?"ui_observed":"not_observed",
        observed:!!check?.observed,websiteUploadVerified:false,
        source:"page_visible_text",origin};
    }
    if(op==="p2_capabilities"){
      const result=await inject(tabId,inspectP2Capabilities);
      return {pageId:tabId,...result};
    }
    if(op==="file_inputs"){
      const discovered=await inject(tabId,discoverFileInputs);
      return {pageId:tabId,...discovered};
    }
    if(op==="upload_file"){
      const uid=args.inputUid,files=args.files,expectedOrigin=args.origin;
      if(args.pageId!==tabId||!Array.isArray(files)||files.length<1||files.length>5 ||
         !files.every(f=>f && typeof f.stagedPath==="string" && isNativeAbsoluteStagePath(f.stagedPath) &&
          typeof f.filename==="string" && f.filename.length>0 && f.filename.length<256))
        throw Error("UPLOAD_ARGUMENTS_INVALID");
      if(new URL(tab.url).origin!==expectedOrigin)throw Error("UPLOAD_ORIGIN_CHANGED");
      await inject(tabId,verifyFileInput,[uid,expectedOrigin,files.length]);
      const target={tabId};
      await chrome.debugger.attach(target,"1.3");
      try{
        const doc=await chrome.debugger.sendCommand(target,"DOM.getDocument",{depth:0});
        const found=await chrome.debugger.sendCommand(target,"DOM.querySelector",{
          nodeId:doc?.root?.nodeId,
          selector:'input[type="file"][data-owl-file-uid="'+uid+'"]'
        });
        if(!Number.isInteger(found?.nodeId)||found.nodeId<1)throw Error("UPLOAD_INPUT_NOT_FOUND_IN_DOM");
        await chrome.debugger.sendCommand(target,"DOM.setFileInputFiles",{
          nodeId:found.nodeId,files:files.map(f=>f.stagedPath)
        });
      }finally{await chrome.debugger.detach(target).catch(()=>{});}
      // Upload widgets (including Teamtailor) may consume the chosen file,
      // clear/recreate the input, and immediately show the filename elsewhere.
      // A DOM input selection is preferred; the precise same-origin filename
      // label is a weaker UI receipt, never a server-upload confirmation.
      let check=null;
      try {check=await inject(tabId,readFileInputSelection,[uid,expectedOrigin]);}
      catch(error){
        if(!String(error).includes("BROWSER_PAGE_EXECUTION_FAILED"))throw error;
      }
      const selected=!!check && check.selectedCount===files.length &&
        Array.isArray(check.fileNames) &&
        check.fileNames.every((n,i)=>n===files[i].filename);
      let siteUiObserved=false;
      if(!selected){
        const latest=await chrome.tabs.get(tabId);
        if(urlOrigin(latest.url)!==expectedOrigin)throw Error("UPLOAD_ORIGIN_CHANGED");
        const observed=await Promise.all(files.map(f=>
          inject(tabId,detectPageReceipt,[f.filename,expectedOrigin])));
        if(!observed.every(r=>r?.observed===true))
          throw Error("UPLOAD_INPUT_OR_UI_CONFIRMATION_MISSING");
        siteUiObserved=true;
      }
      return {pageId:tabId,selected:true,selectedCount:files.length,
        selectedFileNames:files.map(f=>f.filename),siteUiObserved,
        websiteUploadVerified:false};
    }
    if(op==="rich_editor_insert"){
      if(typeof args.uid!=="string"||!/^owl-agent-\d{1,3}$/.test(args.uid)||
         typeof args.value!=="string"||args.value.length>4000)
        throw Error("RICH_EDITOR_ARGUMENT_INVALID");
      const origin=new URL(tab.url).origin;
      const prepared=await inject(tabId,prepareAgentRichEditor,[args.uid,origin]);
      if(prepared?.error)throw Error(prepared.error);
      if(!prepared?.ready)throw Error("EDITOR_NOT_READY");
      const target={tabId};
      await chrome.debugger.attach(target,"1.3");
      try{
        await chrome.debugger.sendCommand(target,"Input.insertText",{text:args.value});
      }finally{await chrome.debugger.detach(target).catch(()=>{});}
      const check=await inject(tabId,checkAgentRichEditor,[args.uid,origin,args.value]);
      if(check?.error)throw Error(check.error);
      if(!check?.domVerified)throw Error("EDITOR_FRAMEWORK_UPDATE_NOT_CONFIRMED");
      return {pageId:tabId,edited:true,uid:args.uid,length:args.value.length,
        domVerified:true,websitePersisted:false,systemKeyboardUsed:false,
        inputMethod:"chromium_trusted_text"};
    }
    if(op==="drop_files"){
      const files=args.files,origin=args.origin,targetUid=args.targetUid;
      if(args.pageId!==tabId||typeof origin!=="string"||!/^owl-agent-\d{1,3}$/.test(targetUid)||
         !Array.isArray(files)||files.length<1||files.length>5 ||
         !files.every(f=>f&&typeof f.stagedPath==="string"&&isNativeAbsoluteStagePath(f.stagedPath)&&
           typeof f.filename==="string"&&f.filename.length>0&&f.filename.length<256))
        throw Error("FILE_DROP_ARGUMENT_INVALID");
      if(new URL(tab.url).origin!==origin)throw Error("FILE_DROP_ORIGIN_CHANGED");
      const zone=await inject(tabId,locateAgentFileDropZone,[targetUid,origin]);
      if(zone?.error)throw Error(zone.error);
      if(!zone?.valid)throw Error("FILE_DROP_TARGET_NOT_APPROVED");
      const target={tabId};
      const dragData={items:[{mimeType:"text/plain",data:"OWL approved local file"}],
        files:files.map(f=>f.stagedPath),dragOperationsMask:1};
      await chrome.debugger.attach(target,"1.3");
      try{
        for(const type of ["dragEnter","dragOver","drop"])
          await chrome.debugger.sendCommand(target,"Input.dispatchDragEvent",{
            type,x:zone.x,y:zone.y,data:dragData
          });
      }finally{await chrome.debugger.detach(target).catch(()=>{});}
      // Dispatch success is not proof that the website uploaded or persisted data.
      await new Promise(resolve=>setTimeout(resolve,250));
      const observed=await inject(tabId,checkAgentFileDropZone,[targetUid,origin,zone.initialHtml]);
      return {pageId:tabId,dispatched:true,transferredCount:files.length,
        fileNames:files.map(f=>f.filename),domObserved:!!observed?.domChanged,
        websiteUploadVerified:false,systemPointerMoved:false,foregroundUnchanged:true,
        state:observed?.domChanged?"ui_observed":"dispatched_unconfirmed"};
    }
    if(op==="cursor_move"||op==="cursor_click"||op==="click"){
      if(typeof args.uid!=="string"||!/^owl-agent-\d{1,3}$/.test(args.uid))
        throw Error("CURSOR_UID_INVALID");
      // Foreground and background are both valid for an explicitly
      // selected Agent-owned or exact-URL adopted tab. Focus is unchanged.
      const origin=urlOrigin(tab.url);
      if(!origin)throw Error("CURSOR_UNSAFE_ORIGIN");
      const click=op!=="cursor_move";
      const zone=await inject(tabId,locateVirtualCursorTarget,
        [args.uid,origin,click?"click":"move"]);
      if(zone?.error)throw Error(zone.error);
      if(!zone?.valid)throw Error("CURSOR_TARGET_NOT_AVAILABLE");
      // Overlay is page-local and pointer-events:none. It is not the
      // actual OS cursor; browser input goes to this tab only.
      const target={tabId};
      let attached=false,fileChooserIntercepted=false;
      const onEvent=(source,method)=>{
        if(source.tabId===tabId&&method==="Page.fileChooserOpened")
          fileChooserIntercepted=true;
      };
      if(click)chrome.debugger.onEvent.addListener(onEvent);
      let dispatched=false;
      try{
        await chrome.debugger.attach(target,"1.3");
        attached=true;
        if(click){
          await chrome.debugger.sendCommand(target,"Page.enable");
          // Prevent JS click handlers from opening a shared OS Finder/Explorer
          // picker: DOM.setFileInputFiles is the safe file-attachment route.
          await chrome.debugger.sendCommand(target,"Page.setInterceptFileChooserDialog",{enabled:true});
        }
        const latest=await chrome.tabs.get(tabId);
        if(urlOrigin(latest.url)!==origin)
          throw Error("CURSOR_PAGE_OR_ORIGIN_CHANGED");
        await inject(tabId,showVirtualCursor,[zone.x,zone.y,click?"click":"move"]);
        await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{
          type:"mouseMoved",x:zone.x,y:zone.y});
        if(click){
          // Re-check immediately before the state-changing event.
          const repeat=await inject(tabId,locateVirtualCursorTarget,[args.uid,origin,"click"]);
          if(repeat?.error||!repeat?.valid||
             Math.abs(repeat.x-zone.x)>3||Math.abs(repeat.y-zone.y)>3)
            throw Error(repeat?.error||"CURSOR_TARGET_MOVED");
          await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{
            type:"mousePressed",x:zone.x,y:zone.y,button:"left",clickCount:1});
          await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{
            type:"mouseReleased",x:zone.x,y:zone.y,button:"left",clickCount:1});
          await new Promise(resolve=>setTimeout(resolve,100));
          if(fileChooserIntercepted)
            throw Error("CURSOR_NATIVE_PICKER_INTERCEPTED_USE_FILE_INPUT_TOOL");
        }
        dispatched=true;
      }finally{
        if(attached)await chrome.debugger.detach(target).catch(()=>{});
        if(click)chrome.debugger.onEvent.removeListener(onEvent);
      }
      return {pageId:tabId,uid:args.uid,x:zone.x,y:zone.y,
        ...(click?{clicked:dispatched,websitePersisted:false}:{moved:dispatched}),
        cursorVisible:true,tabLocal:true,foregroundUnchanged:true,
        osPointerMoved:false,systemMouseUsed:false,
        inputMethod:"tab_scoped_chrome_debugger"};
    }
    if(op==="cursor_hide"){
      const result=await inject(tabId,hideVirtualCursor);
      return {pageId:tabId,...result,foregroundUnchanged:true,tabLocal:true};
    }
    if(op==="snapshot"){
      const result=await inject(tabId,inspect);
      return {pageId:tabId,snapshot:result};
    }
    if(op==="fill"){
      if(typeof args.uid!=="string"||!/^owl-agent-\d{1,3}$/.test(args.uid)||
         typeof args.value!=="string"||args.value.length>4000)
        throw Error("FILL_ARGUMENT_INVALID");
      const origin=urlOrigin(tab.url);
      if(!origin)throw Error("TEXT_ORIGIN_INVALID");
      // A single trusted Chromium input path for ordinary inputs AND modern
      // role=textbox, role=combobox-with-input, contenteditable, open shadow
      // roots. Frameworks must receive their browser events; DOM.value setter
      // alone can appear to work while Google Ads/React state stays unchanged.
      const prepared=await inject(tabId,prepareTrustedTextField,[args.uid,origin]);
      if(prepared?.error)throw Error(prepared.error);
      if(!prepared?.ready)throw Error("TEXT_FIELD_NOT_READY");
      const target={tabId};
      let attached=false;
      try{
        await chrome.debugger.attach(target,"1.3");
        attached=true;
        const latest=await chrome.tabs.get(tabId);
        if(urlOrigin(latest.url)!==origin)throw Error("TEXT_ORIGIN_CHANGED");
        // Extension-scoped Chromium input; does NOT move OS cursor, bring tab
        // to foreground, access the clipboard or require the 9222 port.
        if(args.value.length){
          await chrome.debugger.sendCommand(target,"Input.insertText",{text:args.value});
        }else{
          await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{
            type:"keyDown",key:"Backspace",code:"Backspace",
            windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
          await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{
            type:"keyUp",key:"Backspace",code:"Backspace",
            windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
        }
      }finally{
        if(attached)await chrome.debugger.detach(target).catch(()=>{});
      }
      const checked=await inject(tabId,checkTrustedTextField,[args.uid,origin,args.value]);
      if(checked?.error)throw Error(checked.error);
      if(!checked?.domVerified)throw Error("TEXT_DOM_UPDATE_NOT_CONFIRMED");
      return {pageId:tabId,uid:args.uid,filled:true,length:args.value.length,
        domVerified:true,websitePersisted:false,
        inputMethod:"tab_scoped_chromium_trusted_text",
        foregroundUnchanged:true,systemKeyboardUsed:false};
    }
    if(op==="edit_text"){
      if(typeof args.uid!=="string"||!/^owl-agent-\d{1,3}$/.test(args.uid)||
         typeof args.value!=="string"||args.value.length>4000)
        throw Error("EDITOR_ARGUMENT_INVALID");
      const r=await inject(tabId,operate,[args.uid,args.value,"edit_text"]);
      if(r?.error)throw Error(r.error);
      if(r?.edited!==true)throw Error("EDITOR_NOT_CONFIRMED");
      return {pageId:tabId,...r};
    }
    if(op==="paste_text"){
      if(typeof args.uid!=="string"||!/^owl-agent-\d{1,3}$/.test(args.uid)||
         typeof args.text!=="string"||args.text.length>4000)throw Error("PASTE_ARGUMENT_INVALID");
      const r=await inject(tabId,pastePlainText,[args.uid,args.text,new URL(tab.url).origin]);
      if(r?.error)throw Error(r.error);
      if(r?.pasted!==true||r?.domVerified!==true)throw Error("PASTE_NOT_CONFIRMED");
      return {pageId:tabId,...r};
    }
    if(op==="drag_drop"){
      if(typeof args.sourceUid!=="string"||typeof args.targetUid!=="string"||
         !/^owl-agent-\d{1,3}$/.test(args.sourceUid)||!/^owl-agent-\d{1,3}$/.test(args.targetUid))
        throw Error("DRAG_TARGET_INVALID");
      const r=await inject(tabId,dragDropWithinPage,[args.sourceUid,args.targetUid,new URL(tab.url).origin]);
      if(r?.error)throw Error(r.error);
      if(!r?.domVerified)throw Error("DROP_EFFECT_NOT_OBSERVED");
      return {pageId:tabId,...r};
    }
    if(op==="screenshot"){
      const target={tabId};
      await chrome.debugger.attach(target,"1.3");
      try{
        const shot=await chrome.debugger.sendCommand(target,"Page.captureScreenshot",
          {format:"jpeg",quality:45,captureBeyondViewport:false});
        if(!shot?.data||shot.data.length>4_000_000)throw Error("SCREENSHOT_TOO_LARGE");
        return {pageId:tabId,image:{type:"image",mimeType:"image/jpeg",data:shot.data}};
      }finally{await chrome.debugger.detach(target).catch(()=>{});}
    }
    if(op==="focus_login"){
      await chrome.tabs.update(tabId,{active:true});
      if(Number.isInteger(tab.windowId))await chrome.windows.update(tab.windowId,{focused:true});
      return {pageId:tabId,waitingForHumanLogin:true};
    }
    if(op==="close_tab"){
      // close_tab on an adopted human tab means releasing Agent access;
      // never close a tab that the human had opened before adoption.
      const adopted=!!state.owned[tabId]?.adopted;
      if(!adopted)await chrome.tabs.remove(tabId);
      delete state.owned[tabId];
      if(state.selected[owner]===tabId)delete state.selected[owner];
      await save(state);
      return {pageId:tabId,closed:!adopted,released:true,tabPreserved:adopted};
    }
    throw Error("NATIVE_ACTION_NOT_ALLOWED");
  }
  async function tabRemoved(tabId){
    const state=await read();
    if(!state.owned[tabId])return;
    const owner=state.owned[tabId].owner;
    delete state.owned[tabId];
    if(state.selected[owner]===tabId)delete state.selected[owner];
    await save(state);
  }
  return {run,tabRemoved};
}
