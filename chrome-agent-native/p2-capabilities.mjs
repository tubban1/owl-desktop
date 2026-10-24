// Self-contained DOM function: Chrome serializes it into the Agent-owned tab.
// Read-only probe deliberately excludes closed shadow roots and cross-origin frames.
export function inspectP2Capabilities(){
  const counts={openShadowRoots:0,closedShadowRootsUnknown:true,frames:0,sameOriginFrames:0,crossOriginFrames:0,editableElements:0,dropZones:0};
  const walk=(root,depth=0)=>{
    if(depth>12)return;
    for(const el of root.querySelectorAll('*')){
      if(el.isContentEditable || el.matches('input:not([type=hidden]),textarea,[role=textbox]'))counts.editableElements++;
      if(el.matches('[ondrop],[role=application],[data-dropzone]'))counts.dropZones++;
      if(el.shadowRoot){counts.openShadowRoots++;walk(el.shadowRoot,depth+1);}
    }
  };
  walk(document);
  for(const frame of document.querySelectorAll('iframe')){
    counts.frames++;
    try { if(frame.contentDocument && frame.contentWindow?.location.origin===location.origin)counts.sameOriginFrames++;
      else counts.crossOriginFrames++; }
    catch {counts.crossOriginFrames++; }
  }
  return {origin:location.origin,counts,limits:{crossOriginFrames:'FRAME_ORIGIN_PERMISSION_REQUIRED',closedShadowRoots:'UNAVAILABLE',osClipboard:'NOT_REQUESTED',osGui:'NOT_REQUESTED'},foregroundUnchanged:true};
}
