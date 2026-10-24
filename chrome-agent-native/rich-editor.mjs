// Bounded focused rich-editor input through Chrome tab debugger, never OS keyboard.
// Do not modify DOM content directly: the website framework must process Input.insertText.
export function prepareAgentRichEditor(uid,expectedOrigin){
  if(location.origin!==expectedOrigin)return {error:"EDITOR_ORIGIN_CHANGED"};
  if(!/^owl-agent-\d{1,3}$/.test(uid))return {error:"EDITOR_UID_INVALID"};
  const selector='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
  const find=(root,depth=0)=>{
    if(depth>8)return null;
    const hit=root.querySelector(selector);if(hit)return hit;
    for(const h of root.querySelectorAll("*"))if(h.shadowRoot){
      const inside=find(h.shadowRoot,depth+1);if(inside)return inside;
    }
    return null;
  };
  const el=find(document);
  if(!el)return {error:"AGENT_SNAPSHOT_STALE"};
  if(!el.isContentEditable||el.getAttribute("aria-readonly")==="true")
    return {error:"EDITOR_NOT_EDITABLE"};
  const flag=el.matches(".ProseMirror,.ql-editor,.tiptap,[data-slate-editor],[data-lexical-editor]");
  if(!flag)return {error:"EDITOR_NOT_FRAMEWORK_MANAGED"};
  const label=[el.getAttribute("aria-label"),el.getAttribute("name"),
    el.getAttribute("autocomplete")].filter(Boolean).join(" ");
  if(/password|token|secret|key|otp|passkey|credit.card|cc-|security|删除|付款/i.test(label))
    return {error:"SENSITIVE_OR_INVALID_FIELD"};
  el.focus({preventScroll:true});
  if(document.activeElement!==el&&el.getRootNode().activeElement!==el)
    return {error:"EDITOR_FOCUS_UNCONFIRMED"};
  const selection=getSelection(),range=document.createRange();
  range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);
  if(!selection.rangeCount)return {error:"EDITOR_SELECTION_UNCONFIRMED"};
  return {ready:true,origin:location.origin,uid};
}
export function checkAgentRichEditor(uid,expectedOrigin,value){
  if(location.origin!==expectedOrigin)return {error:"EDITOR_ORIGIN_CHANGED"};
  const selector='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
  const find=(root,depth=0)=>{
    if(depth>8)return null;
    const hit=root.querySelector(selector);if(hit)return hit;
    for(const el of root.querySelectorAll("*"))if(el.shadowRoot){
      const inside=find(el.shadowRoot,depth+1);if(inside)return inside;
    }
    return null;
  };
  const el=find(document);if(!el)return {error:"AGENT_SNAPSHOT_STALE"};
  return {domVerified:el.textContent===value,websitePersisted:false};
}
