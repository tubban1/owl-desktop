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
    // Google Ads-style component shells often have no ARIA role on the outer
    // visual wrapper. Resolve only ONE writable descendant: never guess.
    const found=[],seen=new Set();
    const gather=(root,depth=0)=>{
      if(depth>8)return;
      for(const child of root.querySelectorAll("*")){
        if(!seen.has(child) &&
          (["input","textarea"].includes(child.tagName?.toLowerCase())||
            child.isContentEditable===true)){
          found.push(child);seen.add(child);
        }
        if(child.shadowRoot)gather(child.shadowRoot,depth+1);
      }
    };
    gather(wrapper);
    const eligible=found.filter(child=>visible(child));
    if(eligible.length>1)return {error:"TEXT_TARGET_AMBIGUOUS",count:eligible.length};
    if(eligible.length===1)el=eligible[0];
    else {
      const role=wrapper.getAttribute("role")||"";
      // Textbox shells may create their input only after the browser sends a
      // real click. An onclick handler is not proof that a text control is
      // dangerous; only activate a visible, explicitly text-semantic shell.
      const semantic=["textbox","combobox","searchbox"].includes(role)||
        wrapper.hasAttribute("aria-autocomplete")||
        wrapper.hasAttribute("aria-placeholder")||
        wrapper.hasAttribute("data-placeholder")||
        (wrapper.hasAttribute("inputmode")&&wrapper.getAttribute("inputmode")!=="none");
      const metadata=[
        wrapper.getAttribute("aria-label"),wrapper.getAttribute("name"),
        wrapper.getAttribute("autocomplete"),wrapper.getAttribute("type"),
        wrapper.getAttribute("placeholder"),wrapper.getAttribute("aria-placeholder"),
        wrapper.getAttribute("data-placeholder")
      ].filter(Boolean).join(" ").slice(0,500);
      if(semantic && visible(wrapper) &&
         wrapper.getAttribute("aria-disabled")!=="true" &&
         wrapper.getAttribute("aria-readonly")!=="true" &&
         (["div","span","label"].includes(leaf)||leaf.includes("-"))){
        if(/password|passkey|otp|one.time|verification.code|security.code|token|secret|api.?key|credit.card|cc-|cvv|银行卡|密码/i.test(metadata))
          return {error:"SENSITIVE_OR_INVALID_FIELD"};
        return {activationRequired:true,uid,role,reason:"LAZY_TEXT_CONTROL"};
      }
      return {error:"TEXT_TARGET_NOT_EDITABLE",
        tag:leaf,role,descendantInputCount:found.length};
    }
  }
  const tag=el.tagName?.toLowerCase();
  // The browser normalizes invalid input type attributes (e.g. Google Ads type="string")
  // to a text control. Use the effective DOM type; keep raw attributes in
  // the separate sensitive-field metadata check below.
  const type=(el.type||el.getAttribute("type")||"text").toLowerCase();
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
  el.setAttribute("data-owl-agent-target-input",uid);
  return {ready:true,uid,origin:expectedOrigin,kind:native?"native":"contenteditable",
    nested:el!==wrapper};
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
  const marked='[data-owl-agent-target-input="'+CSS.escape(uid)+'"]';
  const matched=[];
  const seekEditable=(root,depth=0)=>{
    if(depth>8)return;
    for(const child of root.querySelectorAll("*")){
      if(child.matches?.(marked))matched.push(child);
      if(child.shadowRoot)seekEditable(child.shadowRoot,depth+1);
    }
  };
  if(wrapper.matches?.(marked))matched.push(wrapper);
  seekEditable(wrapper);
  if(matched.length!==1)return {error:"TEXT_TARGET_REPLACED_OR_AMBIGUOUS",
    domVerified:false,count:matched.length};
  const el=matched[0];
  const isNative=["input","textarea"].includes(el.tagName?.toLowerCase());
  if(!isNative&&!el.isContentEditable)return {error:"TEXT_CONTROL_REPLACED_BY_APP",domVerified:false};
  const actual=isNative?el.value:el.textContent;
  return {domVerified:actual===expectedValue,
    observedLength:typeof actual==="string"?actual.length:0,
    websitePersisted:false,uid};
}

// Mouse activation is restricted to an explicitly snapshotted semantic text
// shell, not arbitrary buttons. The Chrome debugger dispatches real input
// without using a Windows/macOS system mouse or changing foreground tabs.
export function locateTrustedTextActivation(uid,expectedOrigin){
  if(location.origin!==expectedOrigin)return {error:"TEXT_ORIGIN_CHANGED"};
  if(!/^owl-agent-\d{1,3}$/.test(uid||""))return {error:"TEXT_UID_INVALID"};
  const marker='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
  const locate=(root,depth=0)=>{
    if(depth>8)return null;
    const match=root.querySelector(marker);if(match)return match;
    for(const el of root.querySelectorAll("*"))if(el.shadowRoot){
      const result=locate(el.shadowRoot,depth+1);if(result)return result;
    }
    return null;
  };
  const el=locate(document);
  if(!el)return {error:"AGENT_SNAPSHOT_STALE"};
  const role=el.getAttribute("role")||"";
  if(!["textbox","combobox","searchbox"].includes(role) &&
     !el.hasAttribute("aria-autocomplete")&&!el.hasAttribute("aria-placeholder")&&
     !el.hasAttribute("data-placeholder")&&
     !(el.hasAttribute("inputmode")&&el.getAttribute("inputmode")!=="none"))
    return {error:"TEXT_ACTIVATION_NOT_SEMANTIC"};
  const leaf=el.tagName?.toLowerCase()||"";
  if(!(["div","span","label"].includes(leaf)||leaf.includes("-"))||
     el.getAttribute("aria-disabled")==="true"||
     el.getAttribute("aria-readonly")==="true")
    return {error:"TEXT_ACTIVATION_DISALLOWED"};
  const metadata=[
    el.getAttribute("aria-label"),el.getAttribute("name"),
    el.getAttribute("autocomplete"),el.getAttribute("type"),
    el.getAttribute("placeholder"),el.getAttribute("aria-placeholder"),
    el.getAttribute("data-placeholder")
  ].filter(Boolean).join(" ").slice(0,500);
  if(/password|passkey|otp|one.time|verification.code|security.code|token|secret|api.?key|credit.card|cc-|cvv|银行卡|密码/i.test(metadata))
    return {error:"SENSITIVE_OR_INVALID_FIELD"};
  const style=getComputedStyle(el),r=el.getBoundingClientRect();
  if(style.display==="none"||style.visibility==="hidden"||
     style.pointerEvents==="none"||r.width<4||r.height<4||
     r.bottom<=0||r.right<=0||r.top>=innerHeight||r.left>=innerWidth)
    return {error:"TEXT_ACTIVATION_NOT_VISIBLE"};
  const x=Math.round((Math.max(0,r.left)+Math.min(r.right,innerWidth-1))/2);
  const y=Math.round((Math.max(0,r.top)+Math.min(r.bottom,innerHeight-1))/2);
  const hit=document.elementFromPoint(x,y);
  if(hit!==el&&!el.contains(hit)&&el.getRootNode()?.host!==hit)
    return {error:"TEXT_ACTIVATION_OCCLUDED"};
  return {valid:true,x,y,uid,origin:expectedOrigin};
}

// No field values, HTML, text or credentials are exposed in diagnostics.
export function inspectTrustedTextControl(uid,expectedOrigin){
  if(location.origin!==expectedOrigin)return {error:"TEXT_ORIGIN_CHANGED"};
  if(!/^owl-agent-\d{1,3}$/.test(uid||""))return {error:"TEXT_UID_INVALID"};
  const marker='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
  const find=(root,depth=0)=>{
    if(depth>8)return null;
    const hit=root.querySelector(marker);if(hit)return hit;
    for(const el of root.querySelectorAll("*"))if(el.shadowRoot){
      const nested=find(el.shadowRoot,depth+1);if(nested)return nested;
    }
    return null;
  };
  const el=find(document);if(!el)return {error:"AGENT_SNAPSHOT_STALE"};
  let inputs=0,rich=0,shadow=0;
  const scan=(root,depth=0)=>{
    if(depth>8)return;
    for(const child of root.querySelectorAll("*")){
      if(["input","textarea"].includes(child.tagName?.toLowerCase()))inputs++;
      if(child.isContentEditable===true)rich++;
      if(child.shadowRoot){shadow++;scan(child.shadowRoot,depth+1)}
    }
  };
  scan(el);
  return {uid,tag:el.tagName?.toLowerCase(),role:el.getAttribute("role")||"",
    contentEditable:!!el.isContentEditable,
    ariaAutocomplete:el.hasAttribute("aria-autocomplete"),
    dataPlaceholder:el.hasAttribute("data-placeholder"),
    nativeInputs:inputs,richEditors:rich,openShadowRoots:shadow,
    topFrameOnly:true,diagnosticOnly:true,websitePersisted:false};
}