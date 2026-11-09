// P3: an Agent-owned, tab-local visual cursor. Never touches macOS/Windows input APIs.
// Each injected function is self-contained: Chrome serializes it into an isolated world.
export function locateVirtualCursorTarget(uid,expectedOrigin,mode="move"){
  if(location.origin!==expectedOrigin)return {error:"CURSOR_ORIGIN_CHANGED"};
  if(!/^owl-agent-\d{1,3}$/.test(uid))return {error:"CURSOR_UID_INVALID"};
  if(!["move","click","upload"].includes(mode))return {error:"CURSOR_MODE_INVALID"};
  const selector='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
  const find=(root,depth=0)=>{
    if(depth>8)return null;
    const hit=root.querySelector(selector);if(hit)return hit;
    for(const e of root.querySelectorAll("*"))if(e.shadowRoot){
      const match=find(e.shadowRoot,depth+1);if(match)return match;
    }
    return null;
  };
  const el=find(document);
  if(!el)return {error:"AGENT_SNAPSHOT_STALE"};
  const style=getComputedStyle(el);
  let r=el.getBoundingClientRect();
  // Scroll only this selected Session tab to the observed target. Never
  // scroll a human tab or click a consequential control as a fallback.
  if(r.width>=4 && r.height>=4 &&
     (r.bottom<=0||r.right<=0||r.left>=innerWidth||r.top>=innerHeight)){
    el.scrollIntoView?.({block:"center",inline:"nearest",behavior:"instant"});
    r=el.getBoundingClientRect();
  }
  if(style.visibility==="hidden"||style.display==="none"||style.pointerEvents==="none"||
     r.width<4||r.height<4||r.bottom<=0||r.right<=0||r.left>=innerWidth||r.top>=innerHeight)
    return {error:"CURSOR_TARGET_NOT_VISIBLE"};
  const x=Math.round((Math.max(0,r.left)+Math.min(r.right,innerWidth-1))/2);
  const y=Math.round((Math.max(0,r.top)+Math.min(r.bottom,innerHeight-1))/2);
  const hit=document.elementFromPoint(x,y);
  const belongs=(node)=>{
    if(node===el||el.contains(node))return true;
    // elementFromPoint returns a shadow host for some browsers.
    if(node?.shadowRoot){const internal=node.shadowRoot.elementFromPoint?.(x,y);
      if(internal===el||el.contains(internal))return true;}
    return el.getRootNode()?.host===node;
  };
  if(!belongs(hit))return {error:"CURSOR_TARGET_OCCLUDED"};
  const label=[el.getAttribute("aria-label"),el.getAttribute("title"),
    el.getAttribute("name"),el.getAttribute("placeholder"),el.textContent]
    .filter(Boolean).join(" ").slice(0,500);
  if(mode==="upload"){
    // Used only with an already-authorized one-use local file ticket.
    // Intercept the Chrome chooser BEFORE trusted pointer dispatch; never
    // open the shared OS picker or click an arbitrary consequential control.
    const hint=[el.getAttribute("aria-label"),el.getAttribute("title"),
      el.getAttribute("role"),el.getAttribute("class"),el.textContent]
      .filter(Boolean).join(" ").slice(0,600);
    // The WeChat video upload tile contains a *description* of publishing
    // requirements. Reject consequential actions by the actual control
    // identity, not keywords buried in explanatory text. This exception is
    // restricted to its exact site, route, role and leading upload phrase.
    const uploadLabel=(el.textContent||"").replace(/\s+/g," ").trim();
    const actualAction=[el.getAttribute("aria-label"),el.getAttribute("title")]
      .filter(Boolean).join(" ").trim();
    const safeChannelsTile=location.hostname==="channels.weixin.qq.com"&&
      location.pathname==="/platform/post/create"&&el.tagName==="SPAN"&&
      el.getAttribute("role")==="button"&&/^支持上传/.test(uploadLabel)&&
      /视频/.test(uploadLabel.slice(0,95))&&
      !/上传后?自动?(?:发布|发表|提交)|上传并(?:发布|发表|提交)/.test(uploadLabel.slice(0,120))&&
      !/^(?:发布|发表|提交|删除|支付|确认)/.test(actualAction);
    const dangerousAction=/delete|destroy|logout|checkout|purchase|payment|pay|submit|publish|post|share|password|credential|删除|注销|付款|提交|发布|发送/i;
    if(!/upload|file.?select|file.?picker|choose file|browse files|上传|选择文件|添加视频/i.test(hint)||
       (!safeChannelsTile&&dangerousAction.test(hint)))
      return {error:"UPLOAD_TRIGGER_NOT_APPROVED"};
    if(el.disabled||el.getAttribute("aria-disabled")==="true")
      return {error:"UPLOAD_TRIGGER_DISABLED"};
  }
  if(mode==="click"){
    const danger=/delete|destroy|logout|log.?out|sign.?out|purchase|payment|pay|checkout|unsubscribe|remove|erase|security|password|credential|approve|reject|confirm|submit|publish|post|share|vote|follow|send|order|transfer|upload|select file|choose file|browse files|删除|注销|付款|确认|提交|发布|上传|发送|选择文件/i;
    const tag=el.tagName.toLowerCase(),type=(el.getAttribute("type")||"text").toLowerCase();
    // Read-only text inputs are often a site's custom select opener. Permit
    // ONLY the first pointer click for an explicitly labelled choice; all
    // submission, file-picker and security controls remain human-gated.
    const choiceHint=[el.getAttribute("role"),el.getAttribute("aria-haspopup"),
      el.getAttribute("placeholder")].filter(Boolean).join(" ");
    const classLabel=typeof el.className==="string"?el.className:"";
    const nonSensitiveChoice=!/file|upload|attachment|login|password|credential|token|payment|pay|submit|publish|send|文件|上传|登录|密码|付款|提交|发布|发送/i.test(label);
    const readOnlyChoice=tag==="input"&&type==="text"&&el.readOnly===true&&
      /combobox|listbox|请选择|select (?:an? )?option/i.test(choiceHint);
    const customChoiceHint=[choiceHint,classLabel].filter(Boolean).join(" ");
    const pointerChoice=getComputedStyle(el).cursor==="pointer"&&
      ["div","span","li"].includes(tag)&&label.trim().length>0&&label.length<150;
    const customOpener=pointerChoice&&(
      /(?:select|dropdown|combobox|listbox|picker|choice)/i.test(customChoiceHint)||
      /^(?:选择合集|添加到合集|请选择|选择分类|选择标签|select collection|choose category)$/i.test(label.trim()));
    const safeChoiceOpener=nonSensitiveChoice&&(readOnlyChoice||customOpener);
    const insideChoiceList=!!el.closest?.('[role="listbox"],[class*="select-option"],[class*="select-dropdown"],[class*="dropdown-menu"]');
    // WeChat Channels uses non-ARIA collection rows with labels like
    // "Agent陷阱共3个内容". Accept only this bounded, non-consequential
    // choice shape on its exact publishing page, not arbitrary DIV clicks.
    const wechatCollectionOption=location.hostname==="channels.weixin.qq.com"&&
      location.pathname==="/platform/post/create"&&pointerChoice&&
      /^[^\n]{1,80}共\d+个内容$/.test(label.trim());
    // LinkedIn user-profile curation only: exact benign menu entry on a post.
    // Never allow ordinary submit, removal or a different post action.
    const linkedInFeatured=location.hostname==="www.linkedin.com"&&
      /^\/feed\/update\/urn:li:(?:ugcPost|activity):\d+\/?$/.test(location.pathname)&&
      ["我的职业档案顶部的特色内容","Feature on top of profile"].includes(label.trim())&&
      ["div","li","span","p","label","b","strong"].includes(tag)&&
      !Array.from(el.children||[]).some(ch=>(ch.textContent||"").trim()===label.trim());
    const safeChoiceOption=(el.getAttribute("role")==="option"||
      /(?:select-option|select-item|dropdown-option)/i.test(classLabel)||
      insideChoiceList||wechatCollectionOption)&&
      ["div","li","span"].includes(tag)&&label.trim().length>0&&
      label.length<150&&nonSensitiveChoice;
    // Selecting a record type only changes the editor; never submits DNS.
    const safeDnsTab=(()=>{
      if(location.hostname!=="www.one.com"||location.pathname!=="/admin/dns.do"||
         (el.textContent||"").trim()!=="TXT"||tag==="input")return false;
      for(let p=el.parentElement,d=0;p&&d<6;p=p.parentElement,d++){
        const txt=(p.innerText||p.textContent||"").replace(/\s+/g," ").trim();
        if(txt.length<=260&&["Web forward","Web alias","AAAA","CNAME","MX","TXT","SRV","TLSA"]
          .filter(word=>txt.includes(word)).length>=5)return true;
      }
      return false;
    })();
    const safeGscNoindexRow=
      location.hostname==="search.google.com"&&
      location.pathname==="/search-console/index"&&
      ["被“noindex”标记排除了","由于遇到其他 4xx 问题而被屏蔽了","重复网页，Google 选择的规范网页与用户指定的不同"].includes((el.textContent||"").trim())&&
      !Array.from(el.children||[]).some(
        ch=>(ch.textContent||"").trim()===(el.textContent||"").trim());
    const safeGscExample=(()=>{
      if(location.hostname!=="search.google.com"||
         location.pathname!=="/search-console/index/drilldown")return false;
      const property=(new URLSearchParams(location.search||"")
        .get("resource_id")||"").replace(/^sc-domain:/,"").toLowerCase();
      const text=(el.textContent||"").trim();
      const host=text.match(/^https?:\/\/([a-z0-9.-]+)/i)?.[1]?.toLowerCase();
      return !!property&&!!host&&
        (host===property||host.endsWith("."+property))&&text.length<=150&&
        !Array.from(el.children||[]).some(ch=>
          (ch.textContent||"").trim().startsWith("http"));
    })();
    if(danger.test(label)||(!(safeChoiceOpener||safeChoiceOption||safeDnsTab||safeGscNoindexRow||safeGscExample||linkedInFeatured)&&
       (el.closest("form")||el.hasAttribute("onclick")))||
       el.getAttribute("aria-disabled")==="true"||el.disabled)
      return {error:"CURSOR_ACTION_REQUIRES_HUMAN"};
    if(safeChoiceOpener||safeChoiceOption||safeDnsTab||safeGscNoindexRow||safeGscExample||linkedInFeatured){
      // Only an observed, benign choice opener/option can be clicked here.
      // Submits, uploads, approvals and ambiguous controls stay human-gated.
    }else if(tag==="a"){
      if(el.hasAttribute("download")||el.target&&el.target!=="_self")
        return {error:"CURSOR_ACTION_REQUIRES_HUMAN"};
      let url;try{url=new URL(el.href);}catch{return {error:"CURSOR_UNSAFE_LINK"};}
      if(!["https:","http:"].includes(url.protocol)||url.origin!==location.origin||
         danger.test(url.pathname+url.search))
        return {error:"CURSOR_ACTION_REQUIRES_HUMAN"};
    }else if(tag==="button"||(el.getAttribute("role")||"").toLowerCase()==="button"){
      if(type==="submit"||type==="reset"||type==="file"||!label.trim()||
         /file|browse|attachment|login|sign.?in|authorize|open.*dialog|授权|登录|文件/i.test(label))
        return {error:"CURSOR_ACTION_REQUIRES_HUMAN"};
    }else return {error:"CURSOR_UNSUPPORTED_CONTROL"};
  }
  return {valid:true,x,y,uid,origin:location.origin,tag:el.tagName.toLowerCase()};
}
export function showVirtualCursor(x,y,mode="move"){
  let host=document.querySelector('[data-owl-lab-agent-cursor-host="true"]');
  if(!host){
    host=document.createElement("div");
    host.setAttribute("data-owl-lab-agent-cursor-host","true");
    Object.assign(host.style,{position:"fixed",inset:"0",pointerEvents:"none",
      zIndex:"2147483647",overflow:"visible"});
    const root=host.attachShadow({mode:"closed"});
    const style=document.createElement("style");
    style.textContent=".cursor{position:absolute;width:16px;height:22px;filter:drop-shadow(0 2px 2px #171329a8);pointer-events:none}.cursor svg{display:block}.tag{position:absolute;left:12px;top:19px;white-space:nowrap;background:#6e56cf;color:white;border-radius:5px;padding:3px 6px;font:600 11px system-ui,sans-serif;box-shadow:0 1px 4px #0005;pointer-events:none}";
    const pointer=document.createElement("div");pointer.className="cursor";
    pointer.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="22" viewBox="0 0 16 22"><path d="M1 1v17l4-4 3.5 7 3-1.5-3.4-7H15z" fill="#6e56cf" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="tag">OWL Agent</span>';
    root.append(style,pointer);host.__owlPointer=pointer;
    (document.documentElement||document.body).append(host);
  }
  host.__owlPointer.style.transform="translate("+x+"px,"+y+"px)";
  host.__owlPointer.querySelector(".tag").textContent=mode==="click"?"OWL Agent · click":"OWL Agent";
  return {visible:true,x,y,osPointerMoved:false};
}
export function hideVirtualCursor(){
  const host=document.querySelector('[data-owl-lab-agent-cursor-host="true"]');
  host?.remove();
  return {visible:false,osPointerMoved:false};
}
