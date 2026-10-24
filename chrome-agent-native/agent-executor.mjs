// Only tabs created through this executor can be accessed by an OWL Agent.
// The store is chrome.storage.session: survives service-worker suspension,
// but never authorizes a pre-existing human tab.
const MAX_TABS_PER_OWNER=12;
const urlOrigin=url=>{
  try{const u=new URL(url);return ["http:","https:"].includes(u.protocol)?u.origin:null;}
  catch{return null;}
};
export function createNativeAgentExecutor(chrome,storage){
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
    return result?.[0]?.result;
  }
  function inspect(){
    const visible=e=>{
      const s=getComputedStyle(e),r=e.getBoundingClientRect();
      return s.visibility!=="hidden"&&s.display!=="none"&&r.width>0&&r.height>0;
    };
    const controls=[...document.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]")]
      .filter(visible).slice(0,120).map((el,i)=>{
        const key="owl-agent-"+i;
        el.setAttribute("data-owl-agent-control",key);
        return {uid:key,tag:el.tagName.toLowerCase(),type:el.getAttribute("type")||"",
          label:(el.getAttribute("aria-label")||el.getAttribute("placeholder")||
          el.textContent||el.getAttribute("name")||"").trim().slice(0,125),
          href:el.tagName==="A"?el.href:undefined};
      });
    return {title:document.title,url:location.href,text:(document.body?.innerText||"").slice(0,10000),controls};
  }
  function operate(uid,value,op){
    const el=document.querySelector('[data-owl-agent-control="'+CSS.escape(uid)+'"]');
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
    if(op==="click"){
      // V1 automated click only on ordinary same-origin links.
      // Submission and arbitrary JS buttons remain manually controlled.
      if(el.tagName!=="A"||el.hasAttribute("download")||el.hasAttribute("onclick")||
        (el.target&&el.target!=="_self"))throw Error("CLICK_REQUIRES_HUMAN_CONFIRMATION");
      const url=new URL(el.href);
      if(!["https:","http:"].includes(url.protocol)||url.origin!==location.origin||
        /delete|remove|destroy|logout|pay|buy|checkout|submit|publish|post|share|vote|follow|confirm|approve/i.test(url.pathname+url.search))
        throw Error("CLICK_REQUIRES_HUMAN_CONFIRMATION");
      el.click();return {clicked:true,uid};
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
    if(op==="click"){
      if(typeof args.uid!=="string"||args.uid.length>100)throw Error("CLICK_ARGUMENT_INVALID");
      const r=await inject(tabId,operate,[args.uid,null,"click"]);
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
