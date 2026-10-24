const MAX_DOWNLOADS_PER_OWNER=16;
const MAX_AGE_MS=60*60_000;
const SAFE_EXTENSION=/\.(?:pdf|png|jpe?g|webp|gif|svg|csv|txt|json|md|zip|docx|xlsx|pptx|mp4|mov)$/i;
const DANGER=/(?:^|[/?&=_-])(?:delete|logout|remove|destroy|purchase|checkout|pay|submit|publish|unsubscribe)(?:$|[/?&=_-])/i;

export function inspectAgentDownloadLink(uid,expectedOrigin) {
  if(location.origin!==expectedOrigin)throw Error("DOWNLOAD_ORIGIN_CHANGED");
  if(!/^owl-agent-\d{1,3}$/.test(uid))throw Error("DOWNLOAD_LINK_UID_INVALID");
  const SAFE_EXTENSION=/\.(?:pdf|png|jpe?g|webp|gif|svg|csv|txt|json|md|zip|docx|xlsx|pptx|mp4|mov)$/i;
  const DANGER=/(?:^|[/?&=_-])(?:delete|logout|remove|destroy|purchase|checkout|pay|submit|publish|unsubscribe)(?:$|[/?&=_-])/i;
  const anchor=document.querySelector('a[data-owl-agent-control="'+CSS.escape(uid)+'"]');
  if(!anchor)throw Error("DOWNLOAD_LINK_STALE");
  const url=new URL(anchor.href);
  if(!["https:","http:"].includes(url.protocol)||url.origin!==expectedOrigin ||
     url.username||url.password||DANGER.test(url.pathname+url.search))
    throw Error("DOWNLOAD_LINK_NOT_APPROVED");
  const candidate=(anchor.download||decodeURIComponent(url.pathname.split("/").pop()||"")).normalize("NFC");
  const filename=candidate.replace(/[^\p{L}\p{N}._-]/gu,"_").replace(/^\.+/,"").slice(0,110);
  if(!SAFE_EXTENSION.test(filename))throw Error("DOWNLOAD_FILE_TYPE_UNSUPPORTED");
  return {url:url.href,filename};
}

export function detectPageReceipt(needle,expectedOrigin) {
  if(location.origin!==expectedOrigin)throw Error("RECEIPT_ORIGIN_CHANGED");
  if(typeof needle!=="string"||needle.length<3||needle.length>160)
    throw Error("RECEIPT_TEXT_INVALID");
  const text=(document.body?.innerText||"").toLowerCase();
  return {observed:text.includes(needle.toLowerCase()),origin:location.origin,
    pageTitle:document.title};
}

export function createAgentDownloadWorkflow(chrome,storage,{now=()=>Date.now()}={}) {
  const read=async()=> (await storage.get("owlNativeDownloads")).owlNativeDownloads || {byId:{},requests:{}};
  const write=async s=>storage.set({owlNativeDownloads:s});
  const assertOwner=(s,owner,id)=>{
    const row=s.byId[String(id)];
    if(!row||row.owner!==owner||row.createdAt+MAX_AGE_MS<now())
      throw Error("DOWNLOAD_NOT_OWNED_OR_EXPIRED");
    return row;
  };
  async function state(owner,id,{includePath=false}={}) {
    const s=await read(),row=assertOwner(s,owner,id);
    const hits=await chrome.downloads.search({id:Number(id)});
    const hit=hits?.[0];
    if(!hit)throw Error("DOWNLOAD_NOT_FOUND");
    const result={download_id:hit.id,page_id:row.tabId,
      state:hit.state||"in_progress",bytes_received:hit.bytesReceived??0,
      total_bytes:hit.totalBytes??-1,filename:row.filename,
      source_origin:row.origin,completed:hit.state==="complete"};
    if(hit.error)result.error=hit.error;
    if(includePath){
      if(hit.state!=="complete"||typeof hit.filename!=="string"||!hit.filename)
        throw Error("DOWNLOAD_NOT_COMPLETE");
      return {...result,localPath:hit.filename};
    }
    return result;
  }
  async function start(owner,tab,args,inject){
    const requestId=args.requestId;
    if(typeof requestId!=="string"||!/^[0-9a-f-]{36}$/i.test(requestId))
      throw Error("DOWNLOAD_REQUEST_ID_REQUIRED");
    const s=await read();
    const key=owner+":"+requestId;
    if(s.requests[key])return state(owner,s.requests[key]);
    const count=Object.values(s.byId).filter(x=>x.owner===owner&&x.createdAt+MAX_AGE_MS>now()).length;
    if(count>=MAX_DOWNLOADS_PER_OWNER)throw Error("DOWNLOAD_SESSION_LIMIT");
    const origin=new URL(tab.url).origin;
    const link=await inject(tab.id,inspectAgentDownloadLink,[args.linkUid,origin]);
    if(!link||new URL(link.url).origin!==origin)throw Error("DOWNLOAD_ORIGIN_NOT_ALLOWED");
    const downloadId=await chrome.downloads.download({
      url:link.url,filename:"OWL LAB/"+link.filename,saveAs:false,conflictAction:"uniquify"
    });
    if(!Number.isInteger(downloadId))throw Error("DOWNLOAD_DID_NOT_START");
    s.byId[String(downloadId)]={owner,origin,tabId:tab.id,filename:link.filename,createdAt:now()};
    s.requests[key]=downloadId;
    await write(s);
    return {download_id:downloadId,page_id:tab.id,state:"in_progress",
      filename:link.filename,source_origin:origin,completed:false};
  }
  async function cancel(owner,id) {
    const s=await read();
    assertOwner(s,owner,id);
    const hit=(await chrome.downloads.search({id:Number(id)}))?.[0];
    if(hit?.state==="in_progress")await chrome.downloads.cancel(Number(id));
    return {download_id:id,cancel_requested:true,already_complete:hit?.state==="complete"};
  }
  async function list(owner) {
    const s=await read();
    return {downloads:Object.entries(s.byId)
      .filter(([,v])=>v.owner===owner&&v.createdAt+MAX_AGE_MS>now())
      .map(([id,v])=>({download_id:Number(id),filename:v.filename,
        source_origin:v.origin,page_id:v.tabId}))};
  }
  return {start,state,cancel,list};
}
