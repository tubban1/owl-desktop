// These functions execute only within the Agent-owned document, never in arbitrary Chrome tabs.
export function locateAgentFileDropZone(uid,expectedOrigin){
  if(location.origin!==expectedOrigin)return {error:"FILE_DROP_ORIGIN_CHANGED"};
  if(!/^owl-agent-\d{1,3}$/.test(uid))return {error:"FILE_DROP_UID_INVALID"};
  const selector='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
  const walk=(root,depth=0)=>{
    if(depth>8)return null;
    const match=root.querySelector(selector);
    if(match)return match;
    for(const e of root.querySelectorAll("*"))if(e.shadowRoot){
      const nested=walk(e.shadowRoot,depth+1);if(nested)return nested;
    }
    return null;
  };
  const el=walk(document);
  if(!el)return {error:"AGENT_SNAPSHOT_STALE"};
  if(!el.matches("[data-dropzone],[ondrop]"))return {error:"FILE_DROP_TARGET_NOT_APPROVED"};
  const label=[el.getAttribute("aria-label"),el.textContent].filter(Boolean).join(" ").slice(0,250);
  if(/delete|remove|logout|purchase|pay|checkout|publish|password|credential|删除|注销|付款/i.test(label))
    return {error:"CONSEQUENTIAL_ACTION_REQUIRES_HUMAN"};
  const style=getComputedStyle(el),rect=el.getBoundingClientRect();
  if(style.display==="none"||style.visibility==="hidden"||rect.width<8||rect.height<8)
    return {error:"FILE_DROP_TARGET_NOT_VISIBLE"};
  const x=Math.round(rect.left+rect.width/2),y=Math.round(rect.top+rect.height/2);
  if(x<0||y<0||x>=innerWidth||y>=innerHeight)return {error:"FILE_DROP_TARGET_OFFSCREEN"};
  const hit=document.elementFromPoint(x,y);
  if(!(el===hit||el.contains(hit)||hit?.shadowRoot?.contains(el)))
    return {error:"FILE_DROP_TARGET_OCCLUDED"};
  return {valid:true,x,y,origin:location.origin,uid,initialText:(el.textContent||"").slice(0,400),initialHtml:el.outerHTML.slice(0,2400)};
}
export function checkAgentFileDropZone(uid,expectedOrigin,initialHtml){
  if(location.origin!==expectedOrigin)return {error:"FILE_DROP_ORIGIN_CHANGED"};
  const selector='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
  const walk=(root,depth=0)=>{
    if(depth>8)return null;
    const hit=root.querySelector(selector);if(hit)return hit;
    for(const e of root.querySelectorAll("*"))if(e.shadowRoot){
      const nested=walk(e.shadowRoot,depth+1);if(nested)return nested;
    }
    return null;
  };
  const el=walk(document);
  if(!el)return {domChanged:true,source:"target_removed"};
  return {domChanged:el.outerHTML.slice(0,2400)!==initialHtml,source:"target_outer_html"};
}
