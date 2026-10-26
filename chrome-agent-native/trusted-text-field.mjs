// Self-contained functions serialized by chrome.scripting.executeScript into
// an existing owner-isolated normal Chrome tab (including open shadow roots).
// Trusted typing is dispatched by the extension with chrome.debugger Input.insertText.
// No OS keyboard, 9222 DevTools port, clipboard or synthetic DOM value setter.
export function prepareTrustedTextField(uid,expectedOrigin){
  if(location.origin!==expectedOrigin)return {error:"TEXT_ORIGIN_CHANGED"};
  if(!/^owl-agent-\d{1,3}$/.test(uid||""))return {error:"TEXT_UID_INVALID"};
  const selector='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
  const seek=(root,depth=0)=>{
    if(depth>8)return null;
    const found=root.querySelector(selector);if(found)return found;
    for(const host of root.querySelectorAll("*"))if(host.shadowRoot){
      const inShadow=seek(host.shadowRoot,depth+1);if(inShadow)return inShadow;
    }
    return null;
  };
  const wrapper=seek(document);
  if(!wrapper)return {error:"AGENT_SNAPSHOT_STALE"};
  const visible=el=>{
    const style=getComputedStyle(el),box=el.getBoundingClientRect();
    return style.display!=="none"&&style.visibility!=="hidden"&&
      box.width>0&&box.height>0&&!el.closest("[inert]");
  };
  // Framework-created comboboxes may expose only a wrapper in the snapshot;
  // seek the nested *editable* child, not the clickable dropdown options.
  let el=wrapper;
  const leaf=el.tagName?.toLowerCase();
  const editable=el.isContentEditable===true;
  if(!["input","textarea"].includes(leaf)&&!editable){
    if(el.getAttribute("role")!=="textbox"&&el.getAttribute("role")!=="combobox")
      return {error:"TEXT_TARGET_NOT_EDITABLE"};
    const findEditable=(root,depth=0)=>{
      if(depth>8)return null;
      const found=root.querySelector("input,textarea,[contenteditable]");if(found)return found;
      for(const host of root.querySelectorAll("*"))if(host.shadowRoot){
        const nested=findEditable(host.shadowRoot,depth+1);if(nested)return nested;
      }
      return null;
    };
    el=findEditable(wrapper)||el;
  }
  const tag=el.tagName?.toLowerCase();
  const type=(el.getAttribute("type")||"text").toLowerCase();
  const native=["input","textarea"].includes(tag)&&
    (tag==="textarea"||["text","search","url","email","tel"].includes(type));
  const rich=el.isContentEditable===true;
  if(!native&&!rich)return {error:"TEXT_TARGET_NOT_EDITABLE"};
  if(el.disabled||el.readOnly||el.getAttribute("aria-readonly")==="true"||
     wrapper.getAttribute("aria-readonly")==="true"||
     !visible(wrapper)||!visible(el))return {error:"TEXT_TARGET_NOT_WRITABLE"};
  const metadata=[wrapper,el].map(e=>[
    e.getAttribute("aria-label"),e.getAttribute("name"),e.getAttribute("autocomplete"),
    e.getAttribute("type"),e.getAttribute("data-testid"),e.getAttribute("placeholder")
  ].filter(Boolean).join(" ")).join(" ").slice(0,500);
  if(/password|passkey|otp|one.time|verification.code|security.code|token|secret|api.?key|credit.card|cc-|cvv|银行卡|密码/i.test(metadata))
    return {error:"SENSITIVE_OR_INVALID_FIELD"};
  try{el.focus({preventScroll:true});}
  catch{return {error:"TEXT_FOCUS_FAILED"};}
  const root=el.getRootNode(),focused=root?.activeElement||document.activeElement;
  if(focused!==el)return {error:"TEXT_FOCUS_UNCONFIRMED"};
  try{
    if(native){
      // Replaces existing text, without touching the surrounding page.
      if(typeof el.setSelectionRange!=="function")return {error:"TEXT_SELECTION_UNSUPPORTED"};
      el.setSelectionRange(0,el.value.length);
      if(el.selectionStart!==0||el.selectionEnd!==el.value.length)
        return {error:"TEXT_SELECTION_UNCONFIRMED"};
    }else{
      const selection=(root?.getSelection?.()||document.getSelection());
      const range=document.createRange();
      range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);
      if(!selection.rangeCount)return {error:"TEXT_SELECTION_UNCONFIRMED"};
    }
  }catch{return {error:"TEXT_SELECTION_UNSUPPORTED"};}
  return {ready:true,uid,origin:expectedOrigin,kind:native?"native":"contenteditable"};
}

export function checkTrustedTextField(uid,expectedOrigin,expectedValue){
  if(location.origin!==expectedOrigin)return {error:"TEXT_ORIGIN_CHANGED"};
  const selector='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
  const seek=(root,depth=0)=>{
    if(depth>8)return null;
    const found=root.querySelector(selector);if(found)return found;
    for(const host of root.querySelectorAll("*"))if(host.shadowRoot){
      const hit=seek(host.shadowRoot,depth+1);if(hit)return hit;
    }
    return null;
  };
  const wrapper=seek(document);
  if(!wrapper)return {error:"TEXT_CONTROL_REPLACED_BY_APP",domVerified:false};
  let el=wrapper;
  const tag=el.tagName?.toLowerCase();
  if(!["input","textarea"].includes(tag)&&!el.isContentEditable){
    const seekEditable=(root,depth=0)=>{
      if(depth>8)return null;
      const hit=root.querySelector("input,textarea,[contenteditable]");if(hit)return hit;
      for(const host of root.querySelectorAll("*"))if(host.shadowRoot){
        const nested=seekEditable(host.shadowRoot,depth+1);if(nested)return nested;
      }
      return null;
    };
    el=seekEditable(el)||el;
  }
  const isNative=["input","textarea"].includes(el.tagName?.toLowerCase());
  if(!isNative&&!el.isContentEditable)return {error:"TEXT_CONTROL_REPLACED_BY_APP",domVerified:false};
  const actual=isNative?el.value:el.textContent;
  return {domVerified:actual===expectedValue,
    observedLength:typeof actual==="string"?actual.length:0,
    websitePersisted:false,uid};
}
