// Functions injected into Agent-owned Chrome tabs via chrome.scripting.executeScript.
// Keep them self-contained: Chrome serializes the function body into the page.
// NEVER expose the privileged staged OS path to page JavaScript.
export function discoverFileInputs() {
  const inputs=[...document.querySelectorAll('input[type="file"]')].slice(0,60);
  const result=inputs.map((el,index)=>{
    const uid="owl-file-"+index;
    el.setAttribute("data-owl-file-uid",uid);
    const style=getComputedStyle(el),rect=el.getBoundingClientRect();
    const label=el.id ? document.querySelector('label[for="'+CSS.escape(el.id)+'"]')?.textContent : "";
    return {uid,accept:el.accept||"",multiple:!!el.multiple,disabled:!!el.disabled,
      hidden:el.hidden||style.display==="none"||style.visibility==="hidden"||
        rect.width===0||rect.height===0,
      label:(label||el.getAttribute("aria-label")||el.name||el.id||"").trim().slice(0,110)};
  });
  return {origin:location.origin,url:location.href,inputs:result,
    crossOriginFramesSkipped:document.querySelectorAll("iframe").length>0};
}
export function verifyFileInput(uid,expectedOrigin,expectedCount) {
  if(location.origin!==expectedOrigin)throw Error("UPLOAD_ORIGIN_CHANGED");
  if(!/^owl-file-\d{1,2}$/.test(uid))throw Error("UPLOAD_FILE_UID_INVALID");
  const nodes=document.querySelectorAll('input[type="file"][data-owl-file-uid="'+uid+'"]');
  if(nodes.length!==1)throw Error("UPLOAD_FILE_INPUT_STALE");
  const el=nodes[0];
  if(el.disabled)throw Error("UPLOAD_INPUT_DISABLED");
  if(expectedCount>1&&!el.multiple)throw Error("UPLOAD_INPUT_NOT_MULTIPLE");
  return {valid:true,uid,accept:el.accept||"",multiple:el.multiple};
}
export function readFileInputSelection(uid,expectedOrigin) {
  if(location.origin!==expectedOrigin)throw Error("UPLOAD_ORIGIN_CHANGED");
  if(!/^owl-file-\d{1,2}$/.test(uid))throw Error("UPLOAD_FILE_UID_INVALID");
  const el=document.querySelector('input[type="file"][data-owl-file-uid="'+uid+'"]');
  if(!el)throw Error("UPLOAD_INPUT_MISSING_OR_CHANGED");
  return {origin:location.origin,selectedCount:el.files?.length||0,
    fileNames:[...(el.files||[])].slice(0,5).map(f=>f.name)};
}
