import {createNativeAgentExecutor} from "./agent-executor.mjs";
const executor=createNativeAgentExecutor(chrome,chrome.storage.session);
const HOST="ai.owl.lab.agent";
let port=null;
let serial=Promise.resolve();
let lastError=null;
let reloadScheduled=false;
function connect(){
  if(port)return;
  try{
    const p=chrome.runtime.connectNative(HOST);
    port=p;
    p.onMessage.addListener(message=>{
      if(message?.type==="command"&&typeof message.id==="string"){
        // Immediate transport receipt, before Chrome API / page operations.
        // The host records only receipt counts, never tab URLs or input data.
        try{p.postMessage({type:"command_received",id:message.id});}
        catch{}
        serial=serial.then(async()=>{
          try{
            if(reloadScheduled)throw Error("EXTENSION_RELOAD_IN_PROGRESS");
            const result=await executor.run(message);
            p.postMessage({type:"result",id:message.id,ok:true,result});
            if(message.op==="extension_prepare_reload"&&result?.reloadPrepared){
              reloadScheduled=true;
              // Send the Native Messaging result BEFORE terminating this
              // service worker. Chrome owns the reload; no extension-manager
              // mouse click, OS keyboard, DevTools port, or Chrome shutdown.
              setTimeout(()=>chrome.runtime.reload(),350);
            }
          }catch(e){p.postMessage({type:"result",id:message.id,ok:false,error:String(e?.message||e).slice(0,300)});}
        }).catch(()=>{});
      }
    });
    p.onDisconnect.addListener(()=>{
      lastError=chrome.runtime.lastError?.message||"Native host disconnected";
      if(port===p)port=null;
    });
    lastError=null;
  }catch(e){lastError=String(e?.message||e).slice(0,250);port=null;}
}
chrome.runtime.onInstalled.addListener(()=>connect());
chrome.runtime.onStartup.addListener(()=>connect());
chrome.alarms.create("owlNativeReconnect",{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==="owlNativeReconnect")connect();});
chrome.tabs.onRemoved.addListener(id=>executor.tabRemoved(id).catch(()=>{}));
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(msg?.type==="status"){reply({connected:!!port,lastError});return;}
  if(msg?.type==="connect"){connect();reply({connected:!!port,lastError});return;}
});
connect();
