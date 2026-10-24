// Functions execute solely within an Agent-owned Chrome tab's isolated world.
// They intentionally do not touch the OS clipboard or expose local file data.
export function pastePlainText(uid, text, origin) {
  if(location.origin!==origin) return {error:"PAGE_ORIGIN_CHANGED"};
  if(!/^owl-agent-\d{1,3}$/.test(uid)||typeof text!=="string"||text.length>4000)
    return {error:"PASTE_ARGUMENT_INVALID"};
  const selector='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
  const find=(root,depth=0)=>{
    if(depth>8)return null;
    const hit=root.querySelector(selector);if(hit)return hit;
    for(const el of root.querySelectorAll("*")){
      if(el.shadowRoot){const inside=find(el.shadowRoot,depth+1);if(inside)return inside;}
    }
    return null;
  };
  const el=find(document);
  if(!el)return {error:"AGENT_SNAPSHOT_STALE"};
  const label=((el.getAttribute("aria-label")||"")+" "+(el.getAttribute("name")||"")+" "+(el.getAttribute("autocomplete")||"")).toLowerCase();
  if(/password|secret|token|passkey|otp|one.time|cc-|credit.card|security|删除|付款/.test(label))
    return {error:"SENSITIVE_OR_INVALID_FIELD"};
  if(el.disabled||el.readOnly||el.getAttribute("aria-readonly")==="true")
    return {error:"EDITOR_READ_ONLY"};
  const tag=el.tagName.toLowerCase(), type=(el.getAttribute("type")||"text").toLowerCase();
  const ordinary=(tag==="textarea"||(tag==="input"&&["text","search","url","email","tel"].includes(type)));
  const plainEdit=el.isContentEditable&&!el.closest(".ProseMirror,.ql-editor,.tiptap,[data-slate-editor],[data-lexical-editor]");
  if(!ordinary&&!plainEdit)return {error:"RICH_EDITOR_REQUIRES_SPECIAL_ADAPTER"};
  const current=()=>ordinary?el.value:el.textContent;
  const data=new DataTransfer();data.setData("text/plain",text);
  const accepted=el.dispatchEvent(new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData:data}));
  if(current()===text)return {pasted:true,uid,length:text.length,domVerified:true,websitePersisted:false,method:"site_handler",systemClipboardTouched:false};
  if(!accepted)return {error:"PASTE_HANDLER_REJECTED"};
  const before=el.dispatchEvent(new InputEvent("beforeinput",{bubbles:true,cancelable:true,inputType:"insertFromPaste",data:text}));
  if(!before)return {error:"EDITOR_BEFOREINPUT_REJECTED"};
  if(ordinary){
    const prototype=tag==="textarea"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,"value").set.call(el,text);
  }else el.replaceChildren(document.createTextNode(text));
  el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertFromPaste",data:text}));
  if(current()!==text)return {error:"PASTE_DOM_POSTCONDITION_FAILED"};
  return {pasted:true,uid,length:text.length,domVerified:true,websitePersisted:false,method:"plain_dom",systemClipboardTouched:false};
}

export async function dragDropWithinPage(sourceUid,targetUid,origin){
  if(location.origin!==origin)return {error:"PAGE_ORIGIN_CHANGED"};
  if(!/^owl-agent-\d{1,3}$/.test(sourceUid)||!/^owl-agent-\d{1,3}$/.test(targetUid)||sourceUid===targetUid)
    return {error:"DRAG_TARGET_INVALID"};
  const find=(uid)=>{
    const selector='[data-owl-agent-control="'+CSS.escape(uid)+'"]';
    const seek=(root,depth=0)=>{
      if(depth>8)return null;
      const hit=root.querySelector(selector);if(hit)return hit;
      for(const el of root.querySelectorAll("*")){
        if(el.shadowRoot){const child=seek(el.shadowRoot,depth+1);if(child)return child;}
      }
      return null;
    };
    return seek(document);
  };
  const source=find(sourceUid),target=find(targetUid);
  if(!source||!target)return {error:"AGENT_SNAPSHOT_STALE"};
  if(source.getAttribute("draggable")!=="true")return {error:"DRAG_SOURCE_NOT_DRAGGABLE"};
  if(!target.matches("[data-dropzone],[ondrop],[role=listbox],[role=list]"))
    return {error:"DROP_TARGET_NOT_APPROVED"};
  const sensitive=/delete|remove|destroy|logout|pay|checkout|publish|credential|password|delete account|删除|付款/i;
  if(sensitive.test((source.getAttribute("aria-label")||"")+" "+(target.getAttribute("aria-label")||"")))
    return {error:"CONSEQUENTIAL_ACTION_REQUIRES_HUMAN"};
  const beforeTarget=target.outerHTML.slice(0,12000);
  const beforeSourceParent=source.parentElement?.innerHTML.slice(0,12000)||"";
  const transfer=new DataTransfer();
  transfer.setData("text/plain",sourceUid);transfer.effectAllowed="move";
  const emit=(node,type)=>node.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer}));
  emit(source,"dragstart");
  emit(target,"dragenter");emit(target,"dragover");emit(target,"drop");emit(source,"dragend");
  await new Promise(resolve=>setTimeout(resolve,80));
  const changed=target.outerHTML.slice(0,12000)!==beforeTarget||
    (source.parentElement?.innerHTML.slice(0,12000)||"")!==beforeSourceParent;
  if(!changed)return {error:"DROP_EFFECT_NOT_OBSERVED"};
  return {dispatched:true,domVerified:true,websitePersisted:false,
    sourceUid,targetUid,systemPointerMoved:false,fileTransferred:false,syntheticEvents:true};
}
