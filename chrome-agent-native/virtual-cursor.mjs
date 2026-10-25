// P3: an Agent-owned, tab-local visual cursor. Never touches macOS/Windows input APIs.
// Each injected function is self-contained: Chrome serializes it into an isolated world.
export function locateVirtualCursorTarget(uid,expectedOrigin,mode="move"){
  if(location.origin!==expectedOrigin)return {error:"CURSOR_ORIGIN_CHANGED"};
  if(!/^owl-agent-\d{1,3}$/.test(uid))return {error:"CURSOR_UID_INVALID"};
  if(mode!=="move"&&mode!=="click")return {error:"CURSOR_MODE_INVALID"};
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
  const style=getComputedStyle(el),r=el.getBoundingClientRect();
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
    el.getAttribute("name"),el.textContent].filter(Boolean).join(" ").slice(0,500);
  if(mode==="click"){
    const danger=/delete|destroy|logout|log.?out|sign.?out|purchase|payment|pay|checkout|unsubscribe|remove|erase|security|password|credential|approve|reject|confirm|submit|publish|post|share|vote|follow|send|order|transfer|upload|select file|choose file|browse files|删除|注销|付款|确认|提交|发布|上传|发送|选择文件/i;
    const tag=el.tagName.toLowerCase(),type=(el.getAttribute("type")||"").toLowerCase();
    if(danger.test(label)||el.closest("form")||el.hasAttribute("onclick")||
       el.getAttribute("aria-disabled")==="true"||el.disabled)
      return {error:"CURSOR_ACTION_REQUIRES_HUMAN"};
    if(tag==="a"){
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
