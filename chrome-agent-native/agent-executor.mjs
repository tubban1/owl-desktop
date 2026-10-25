import {discoverFileInputs,verifyFileInput,readFileInputSelection} from "./file-inputs.mjs";
import {createAgentDownloadWorkflow,detectPageReceipt} from "./download-workflow.mjs";
import {inspectP2Capabilities} from "./p2-capabilities.mjs";
import {pastePlainText,dragDropWithinPage} from "./p2-interactions.mjs";
import {locateAgentFileDropZone,checkAgentFileDropZone} from "./file-drop-zone.mjs";
import {prepareAgentRichEditor,checkAgentRichEditor} from "./rich-editor.mjs";
import {locateVirtualCursorTarget,showVirtualCursor,hideVirtualCursor} from "./virtual-cursor.mjs";

// Only tabs created through this executor can be accessed by an OWL Agent.
// The store is chrome.storage.session: survives service-worker suspension,
// but never authorizes a pre-existing human tab.
const MAX_TABS_PER_OWNER=12;
const urlOrigin=url=>{
  try{const u=new URL(url);return ["http:","https:"].includes(u.protocol)?u.origin:null;}
  catch{return null;}
};
export function createNativeAgentExecutor(chrome,storage){
  const downloads=createAgentDownloadWorkflow(chrome,storage);
  const read=async()=>({owned:(await storage.get("owlNativeOwned")).owlNativeOwned||{},
    selected:(await storage.get("owlNativeSelected")).owlNativeSelected||{}});
  const save=async s=>storage.set({owlNativeOwned:s.owned,owlNativeSelected:s.selected});
  async function current(owner,args={},requireSelected=true){
    const state=await read();
    const tabId=args.tabId??state.selected[owner];
    if(!Number.isInteger(tabId)||state.owned[tabId]?.owner!==owner)
      throw Error("AGENT_TAB_NOT_OWNED");
    let tab;
    try{tab=await chrome.tabs.get(tabId);}
    catch{delete state.owned[tabId];if(state.selected[owner]===tabId)delete state.selected[owner];await save(state);throw Error("AGENT_TAB_CLOSED");}
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
        if(el.matches("a,button,input,textarea,select,[role=button],[contenteditable]:not([contenteditable=false]),[draggable=true],[data-dropzone]") &&
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
        label:(el.getAttribute("aria-label")||el.getAttribute("placeholder")||
        el.textContent||el.getAttribute("name")||"").trim().slice(0,125),
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
    if(op==="open"){
      const url=args.url;
      if(typeof url!=="string"||url.length>2048||!urlOrigin(url))throw Error("NATIVE_URL_INVALID");
      const state=await read();
      if(Object.values(state.owned).filter(x=>x.owner===owner).length>=MAX_TABS_PER_OWNER)throw Error("OWNER_TAB_LIMIT");
      const tab=await chrome.tabs.create({url,active:false});
      state.owned[tab.id]={owner,createdAt:Date.now()};
      state.selected[owner]=tab.id;await save(state);
      return {pageId:tab.id,tabId:tab.id,url,background:true,usesExistingChromeProfile:true};
    }
    if(op==="tabs"){
      const s=await read(),tabs=[];
      for(const [key,value] of Object.entries(s.owned)){
        if(value.owner!==owner)continue;
        try{const tab=await chrome.tabs.get(Number(key));tabs.push({pageId:tab.id,url:tab.url,selected:s.selected[owner]===tab.id});}
        catch{}
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
    const {state,tab,tabId}=await current(owner,op==="close_tab"?{tabId:args.pageId}:{});
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
         !files.every(f=>f && typeof f.stagedPath==="string" && f.stagedPath.startsWith("/") &&
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
      const check=await inject(tabId,readFileInputSelection,[uid,expectedOrigin]);
      if(check.selectedCount!==files.length ||
         !check.fileNames.every((n,i)=>n===files[i].filename))throw Error("UPLOAD_SELECTION_UNCONFIRMED");
      return {pageId:tabId,selected:true,selectedCount:check.selectedCount,
        selectedFileNames:check.fileNames,websiteUploadVerified:false};
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
         !files.every(f=>f&&typeof f.stagedPath==="string"&&f.stagedPath.startsWith("/")&&
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
      // A personal Chrome foreground tab is not an autonomous target,
      // even when the Agent originally created it: hand it to its human.
      if(tab.active)throw Error("AGENT_TAB_FOREGROUND_NEEDS_HUMAN");
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
        if(latest.active||urlOrigin(latest.url)!==origin)
          throw Error("CURSOR_PAGE_OR_FOCUS_CHANGED");
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
      if(typeof args.uid!=="string"||args.uid.length>100||typeof args.value!=="string"||args.value.length>4000)
        throw Error("FILL_ARGUMENT_INVALID");
      const r=await inject(tabId,operate,[args.uid,args.value,"fill"]);
      return {pageId:tabId,...r};
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
      await chrome.tabs.remove(tabId);
      delete state.owned[tabId];
      if(state.selected[owner]===tabId)delete state.selected[owner];
      await save(state);
      return {pageId:tabId,closed:true};
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
