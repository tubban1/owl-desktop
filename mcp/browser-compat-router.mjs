// Unified browser compatibility route. Native Chrome is the safe default
// on macOS AND Windows. Isolated Chromium requires explicit opt-in.
export function createBrowserCompatRouter({native,isolated,sessionId}) {
  const modes=new Map();
  const id=()=> {
    const value=sessionId();
    if(typeof value!=="string"||!value)throw Error("BROWSER_SESSION_REQUIRED");
    return value;
  };
  const setMode=value=>{
    const owner=id();
    modes.delete(owner);
    modes.set(owner,value);
    if(modes.size>128)modes.delete(modes.keys().next().value);
  };
  const mode=()=>modes.get(id())??"chrome";
  const userChrome=()=>{
    const out=native();
    if(!out?.bridge||!out?.owner)throw Error("CHROME_NATIVE_BRIDGE_UNAVAILABLE");
    return out;
  };
  const primitive=(primitive,op,args,timeoutMs)=>isolated(primitive,op,args,timeoutMs);
  return {
    async open({url,mode:requested,headless=false,...options}) {
      if(requested==="chrome"&&headless)throw Error("CHROME_PERSONAL_PROFILE_ALWAYS_VISIBLE");
      const next=requested??(headless?"isolated":"chrome");
      if(next==="isolated") {
        const result=await primitive("web.open","navigate",{url,headless,...options},300000);
        setMode("isolated");
        return result;
      }
      const {bridge,owner}=userChrome();
      const result=await bridge.open(owner,url);
      setMode("chrome");
      return {...result,browserMode:"existing-chrome",newBrowserProcess:false};
    },
    async tabs() {
      if(mode()==="isolated")return primitive("web.session","tabs",{});
      const {bridge,owner}=userChrome();
      return bridge.tabs(owner);
    },
    async use({page_id,index,tab_id}={}) {
      if(mode()==="isolated")return primitive("web.session","use_tab",{index,tab_id});
      const {bridge,owner}=userChrome();
      let pageId=page_id;
      if(pageId===undefined&&typeof tab_id==="string"&&/^\d+$/.test(tab_id))pageId=Number(tab_id);
      if(pageId===undefined&&index!==undefined) {
        const items=(await bridge.tabs(owner)).tabs??[];
        pageId=items[index]?.pageId;
      }
      if(!Number.isSafeInteger(pageId)||pageId<0)throw Error("CHROME_AGENT_PAGE_ID_REQUIRED: choose a page_id from browser_list_tabs.");
      return bridge.use(owner,pageId);
    },
    async close() {
      if(mode()==="isolated")return primitive("web.session","close",{});
      const {bridge,owner}=userChrome();
      const current=(await bridge.tabs(owner)).tabs?.find(t=>t.selected);
      if(!current)return {closed:false,reason:"NO_SELECTED_AGENT_TAB",browserMode:"existing-chrome"};
      // The bridge preserves adopted human tabs (releases owner grant only).
      return bridge.closeTab(owner,current.pageId);
    },
    async snapshot(args={}) {
      if(mode()==="isolated")return primitive("web.query","snapshot",args);
      const {bridge,owner}=userChrome();
      return bridge.snapshot(owner);
    },
    async click({selector}) {
      if(mode()==="isolated")return primitive("web.act","click",{selector});
      if(!/^owl-agent-\d{1,3}$/.test(selector))throw Error("CHROME_NATIVE_UID_REQUIRED: run browser_snapshot and use the returned owl-agent-N control UID; CSS selectors are isolated-browser-only.");
      const {bridge,owner}=userChrome();
      return bridge.click(owner,selector);
    },
    async type({selector,text,submit=false}) {
      if(mode()==="isolated")return primitive("web.act","type",{selector,text,submit});
      if(submit)throw Error("CHROME_NATIVE_SUBMIT_REQUIRES_REVIEW: Use approved browser_agent_form_review/submit for consequential submission.");
      if(!/^owl-agent-\d{1,3}$/.test(selector))throw Error("CHROME_NATIVE_UID_REQUIRED: use the observed owl-agent-N field UID from browser_snapshot.");
      const {bridge,owner}=userChrome();
      return bridge.fill(owner,selector,text);
    },
    async screenshot({path,full_page=false}={}) {
      if(mode()==="isolated")return {isolated:true,result:await primitive("vision.capture","page",{path,full_page})};
      if(full_page)throw Error("CHROME_NATIVE_VIEWPORT_ONLY: use explicit isolated Chromium for full-page capture.");
      const {bridge,owner}=userChrome();
      const result=await bridge.screenshot(owner);
      return {isolated:false,...result,requestedFilePath:path??null,storedToRequestedPath:false};
    },
    currentMode:mode,
  };
}
