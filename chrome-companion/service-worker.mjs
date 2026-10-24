import {grantFor, grantIsCurrent, sanitizeSnapshot} from "./permission-policy.mjs";
import {permittedOrigin, originPattern} from "./agent-tab-policy.mjs";
import {createAgentTabController} from "./agent-tabs-controller.mjs";

const GRANT="owlAttachedTab", LINK="owlDesktopLink", PENDING="owlPendingClick";
const BROKER="http://127.0.0.1:8794";
const memory={polling:false};
async function get(key){return (await chrome.storage.session.get(key))[key]||null;}
async function put(key,value){await chrome.storage.session.set({[key]:value});}
async function clear(key){await chrome.storage.session.remove(key);}
const agentTabs=createAgentTabController(chrome,{get,put,clear});
async function revoke(){await clear(GRANT);await clear(PENDING);await chrome.alarms.clear("owlCompanionGrantExpiry").catch(()=>{});await stopCapture();await chrome.action.setBadgeText({text:""}).catch(()=>{});}
async function linkedRequest(path,payload={},tokenOverride=null){
  const link=await get(LINK);
  const token=tokenOverride||link?.token;
  if(!token&&path!=="/v1/pair")throw new Error("Pair with OWL first.");
  const response=await fetch(BROKER+path,{
    method:"POST",
    headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(4500),
  });
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||"Local OWL Companion unavailable");
  return result.data;
}
async function authorizedTab(){
  const grant=await get(GRANT);
  if(!grant)throw new Error("Click Attach on the website first.");
  let tab;
  try{tab=await chrome.tabs.get(grant.tabId);}
  catch{await revoke();throw new Error("Authorized tab closed.");}
  if(!grantIsCurrent(grant,tab)){await revoke();throw new Error("Tab origin changed or grant expired.");}
  return {tab,grant};
}
function readVisiblePage(){
  const visible=el=>{
    const style=getComputedStyle(el),rect=el.getBoundingClientRect();
    return style.display!=="none"&&style.visibility!=="hidden"&&rect.width>0&&rect.height>0;
  };
  const controls=[...document.querySelectorAll("button,input,textarea,select,[role='button']")]
    .filter(visible).slice(0,50).map(el=>({
      tag:el.tagName.toLowerCase(),type:el.getAttribute("type"),
      label:el.getAttribute("aria-label")||el.getAttribute("placeholder")||
        el.getAttribute("name")||(el.textContent||"").trim()
    }));
  return {url:location.href,title:document.title,
    text:(document.body?.innerText||"").slice(0,5000),controls};
}
function fillControl(selector,text){
  const elements=document.querySelectorAll(selector);
  if(elements.length!==1)throw new Error("Selector must match exactly one field.");
  const el=elements[0],tag=el.tagName.toLowerCase();
  if(!["input","textarea"].includes(tag))throw new Error("Only text fields may be filled.");
  const type=(el.getAttribute("type")||"text").toLowerCase();
  const ac=(el.getAttribute("autocomplete")||"").toLowerCase();
  if(["password","hidden","file","submit","button","checkbox","radio","number","date"].includes(type)||
    ["one-time-code","current-password","new-password","cc-number","cc-csc"].includes(ac)||
    el.disabled||el.readOnly)throw new Error("This field is protected or read-only.");
  const descriptor=Object.getOwnPropertyDescriptor(
    tag==="textarea"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value");
  descriptor.set.call(el,text);
  el.dispatchEvent(new Event("input",{bubbles:true}));
  el.dispatchEvent(new Event("change",{bubbles:true}));
  return {filled:true,selector,valueLength:text.length,origin:location.origin};
}
function inspectClickTarget(selector){
  const matches=document.querySelectorAll(selector);
  if(matches.length!==1)throw new Error("Click must match exactly one control.");
  const el=matches[0];
  const label=(el.innerText||el.getAttribute("aria-label")||el.getAttribute("title")||"").trim();
  const tag=el.tagName.toLowerCase(), role=el.getAttribute("role");
  if(!["button","a"].includes(tag)&&role!=="button")
    throw new Error("Click target is not an interactive control.");
  if(/delete|remove|pay|purchase|checkout|buy|erase|logout|sign out|supprimer|löschen/i.test(label))
    throw new Error("Destructive action must be done manually.");
  return {label:label.slice(0,120),tag};
}

function clickControl(selector){
  const elements=document.querySelectorAll(selector);
  if(elements.length!==1)throw new Error("Selector must match exactly one element.");
  const el=elements[0],label=(el.innerText||el.getAttribute("aria-label")||"").trim();
  const role=el.getAttribute("role");
  if(!["button","a"].includes(el.tagName.toLowerCase())&&role!=="button")
    throw new Error("Only interactive controls may be clicked.");
  if(/delete|remove|pay|purchase|checkout|buy|erase|logout|sign out|supprimer|löschen/i.test(label))
    throw new Error("Protected action: use the website manually.");
  if(el.disabled)throw new Error("Button disabled.");
  el.click();
  return {clicked:true,selector,label:label.slice(0,80),origin:location.origin};
}
async function executeInPage(tab,func,args=[]){
  const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func,args});
  return result?.[0]?.result;
}
async function targetTab(){
  const agent=await agentTabs.active();
  if(agent){
    if(agent.loginRequired)throw new Error("AGENT_LOGIN_REQUIRED: Open the agent tab from Companion to finish login; then let OWL continue.");
    return {...agent, agentOwned:true, grant:{canFill:true,origin:agent.record.origin}};
  }
  return {...await authorizedTab(),agentOwned:false};
}
async function snapshot(){
  const {tab}=await targetTab();
  const payload=await executeInPage(tab,readVisiblePage);
  if(!payload||new URL(payload.url).origin!==new URL(tab.url).origin){
    await revoke();throw new Error("Site changed during inspection.");
  }
  return {tabId:tab.id,...sanitizeSnapshot(payload)};
}
async function stopCapture(){
  await clear("owlCaptureTab");
  try{await chrome.runtime.sendMessage({channel:"owl-offscreen",type:"stop"});}catch{}
  try{await chrome.offscreen.closeDocument();}catch{}
}
async function startCapture(){
  const {tab}=await targetTab();
  const [active]=await chrome.tabs.query({active:true,currentWindow:true});
  if(active?.id!==tab.id)throw new Error("Switch to the authorized tab before starting capture.");
  const contexts=await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"]});
  if(!contexts.length){
    await chrome.offscreen.createDocument({url:"offscreen.html",reasons:["USER_MEDIA"],
      justification:"Capture only the explicitly authorized browser tab without stealing focus"});
  }
  const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
  const result=await chrome.runtime.sendMessage({channel:"owl-offscreen",type:"start",streamId});
  if(!result?.ok)throw new Error(result?.error||"Tab video capture failed");
  await put("owlCaptureTab",tab.id);
  return {capturing:true,tabId:tab.id};
}
async function captureFrame(){
  const {tab,grant}=await targetTab();
  if(await get("owlCaptureTab")!==tab.id)throw new Error("User must first enable tab capture in the extension popup.");
  const result=await chrome.runtime.sendMessage({channel:"owl-offscreen",type:"frame"});
  if(!result?.ok)throw new Error(result?.error||"Tab video capture unavailable");
  return {tabId:tab.id,origin:grant.origin,...result.data};
}

async function executeWork(request){
  if(request.op==="agent_open") return await agentTabs.open(request.args.url);
  if(request.op==="agent_tabs") return {tabs:await agentTabs.tabs()};
  if(request.op==="agent_use_tab") return await agentTabs.select(request.args.tabId);
  if(request.op==="agent_close_tab") return await agentTabs.close(request.args.tabId);
  const {tab,grant}=await targetTab();
  if(request.op==="snapshot")return await snapshot();
  if(request.op==="screenshot")return await captureFrame();
  if(!grant.canFill)throw new Error("User has not enabled form editing.");
  if(request.op==="fill"){
    const data=await executeInPage(tab,fillControl,[request.args.selector,request.args.text]);
    return {tabId:tab.id,...data};
  }
  if(request.op==="click"){
    // Never auto-click. Store until the human explicitly approves in popup.
    const target=await executeInPage(tab,inspectClickTarget,[request.args.selector]);
    await put(PENDING,{id:request.id,selector:request.args.selector,
      label:target.label,tag:target.tag,
      origin:grant.origin,tabId:tab.id,expiresAt:Date.now()+75000});
    await chrome.action.setBadgeBackgroundColor({color:"#D97706"}).catch(()=>{});
    await chrome.action.setBadgeText({text:"!"}).catch(()=>{});
    return null;
  }
  throw new Error("Unsupported action");
}
async function poll(){
  if(memory.polling)return;
  memory.polling=true;
  try{
    const link=await get(LINK);
    if(!link||Date.parse(link.expiresAt)<=Date.now()){if(link)await clear(LINK);return;}
    const {requests}=await linkedRequest("/v1/poll");
    for(const request of requests||[]){
      try{
        const result=await executeWork(request);
        if(result!==null)await linkedRequest("/v1/result",{id:request.id,ok:true,result});
      }catch(error){
        await linkedRequest("/v1/result",{id:request.id,ok:false,error:String(error?.message||error).slice(0,160)});
      }
    }
  }catch{ /* Offline or expired; popup exposes connection status. */}
  finally{memory.polling=false;}
}
let loop=null;
function ensurePolling(){
  if(loop)return;
  loop=setInterval(()=>void poll(),1500);
  void poll();
}
if(chrome.alarms){
  chrome.alarms.create("owlCompanionPoll",{periodInMinutes:0.5});
  chrome.alarms.onAlarm.addListener(async alarm=>{
    if(alarm.name==="owlCompanionPoll"){ensurePolling();void poll();}
    if(alarm.name==="owlCompanionGrantExpiry"){
      const grant=await get(GRANT);
      if(grant && grant.expiresAt<=Date.now())await revoke();
    }
  });
}
ensurePolling();
async function execute(command){
  switch(command.op){
    case "status":{
      const storedGrant=await get(GRANT),link=await get(LINK),pending=await get(PENDING);
      let grant=null;
      if(storedGrant){try{await authorizedTab();grant=storedGrant;}catch{grant=null;}}
      const autonomous=await agentTabs.status();
      const owned=await agentTabs.tabs();
      return {agentSite:autonomous,agentTabs:owned,authorized:!!grant,paired:!!link&&Date.parse(link.expiresAt)>Date.now(),
        origin:grant?.origin||null,expiresAt:grant?.expiresAt||null,
        canFill:!!grant?.canFill,capturing:Boolean(grant&&await get("owlCaptureTab")===grant.tabId),pending:pending?{selector:pending.selector,label:pending.label,origin:pending.origin}:null};
    }
    case "pair":{
      await agentTabs.revoke();
      const code=String(command.code||"").replaceAll(" ","").trim().toUpperCase();
      if(!/^[0-9A-F]{16}$/.test(code))throw new Error("Enter the 16-character OWL pairing code.");
      const result=await linkedRequest("/v1/pair",{code});
      await put(LINK,result);ensurePolling();
      return {paired:true,expiresAt:result.expiresAt};
    }
    case "attach":{
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      const grant={...grantFor(tab),canFill:false};
      await put(GRANT,grant);await clear(PENDING);
      chrome.alarms.create("owlCompanionGrantExpiry",{when:grant.expiresAt});
      return {authorized:true,origin:grant.origin,tabId:grant.tabId,expiresAt:grant.expiresAt};
    }
    case "enableEditing":{
      const {grant}=await authorizedTab();
      grant.canFill=true;await put(GRANT,grant);
      return {authorized:true,canFill:true,origin:grant.origin};
    }
    case "grantAgentSite":{
      const link=await get(LINK);
      if(!link||Date.parse(link.expiresAt)<=Date.now())throw new Error("Pair OWL LAB before authorizing agent site access.");
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      const current=permittedOrigin(tab?.url);
      if(!current||command.origin!==current)throw new Error("AGENT_SITE_ORIGIN_MISMATCH");
      return await agentTabs.authorize(current);
    }
    case "agentStatus":return agentTabs.status();
    case "focusAgentLoginTab":return agentTabs.focusForLogin();
    case "revokeAgentSite":{
      const previous=await get("owlAgentSiteGrant");
      await agentTabs.revoke();
      if(previous.origin){
        await chrome.permissions.remove({origins:[originPattern(previous.origin)]}).catch(()=>{});
      }
      return {enabled:false};
    }
    case "snapshot":return snapshot();
    case "startCapture":return startCapture();
    case "stopCapture":await stopCapture();return {capturing:false};
    case "approveClick":{
      const request=await get(PENDING);
      if(!request||Date.now()>request.expiresAt)throw new Error("Click request expired.");
      const {tab}=await targetTab();
      if(tab.id!==request.tabId||new URL(tab.url).origin!==request.origin)
        throw new Error("Click target changed.");
      await clear(PENDING);
      await chrome.action.setBadgeText({text:""});
      try{
        const result=await executeInPage(tab,clickControl,[request.selector]);
        const receipt={tabId:tab.id,...result,explicitUserApproval:true};
        await linkedRequest("/v1/result",{id:request.id,ok:true,result:receipt});
        return receipt;
      }catch(error){
        await linkedRequest("/v1/result",{id:request.id,ok:false,error:String(error?.message||error).slice(0,160)}).catch(()=>{});
        throw error;
      }
    }
    case "rejectClick":{
      const request=await get(PENDING);await clear(PENDING);
      await chrome.action.setBadgeText({text:""});
      if(request)await linkedRequest("/v1/result",{id:request.id,ok:false,error:"User rejected click"}).catch(()=>{});
      return {rejected:true};
    }
    case "detach":{
      await revoke();return {authorized:false};
    }
    case "disconnect":{
      await linkedRequest("/v1/revoke").catch(()=>{});
      await clear(LINK);await revoke();await agentTabs.revoke();return {paired:false};
    }
    default:throw new Error("Unsupported command");
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  // The offscreen frame receiver handles this private channel. Replying here
  // would race its response and break screenshot capture.
  if(message?.channel==="owl-offscreen")return false;
  if(sender.id!==chrome.runtime.id||
     sender.url!==chrome.runtime.getURL("popup.html")){
    respond({ok:false,error:"UNTRUSTED_SENDER"});return false;
  }
  Promise.resolve().then(()=>execute(message||{}))
    .then(data=>respond({ok:true,data}))
    .catch(error=>respond({ok:false,error:String(error?.message||error)}));
  return true;
});
chrome.tabs.onRemoved.addListener(async id=>{
  await agentTabs.remove(id);
  const grant=await get(GRANT);if(grant?.tabId===id)await revoke();
});
chrome.tabs.onUpdated.addListener(async(id,change,tab)=>{
  const grant=await get(GRANT);
  if(grant?.tabId===id&&change.url&&!grantIsCurrent(grant,tab))await revoke();
});
