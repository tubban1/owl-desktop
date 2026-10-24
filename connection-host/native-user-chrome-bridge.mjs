export function createNativeChromeBridge({broker,uploadBroker}) {
  if(!broker?.request||!broker?.status)throw Error("NATIVE_BROKER_REQUIRED");
  const req=(owner,op,args)=>broker.request(owner,op,args);
  const upload=uploadBroker;
  const fileInputs=owner=>req(owner,"file_inputs");
  async function prepareFile(owner,filePath){
    if(!upload)throw Error("UPLOAD_BROKER_UNAVAILABLE");
    const target=await fileInputs(owner);
    return upload.prepare({owner,filePath,origin:target.origin});
  }
  async function uploadFile(owner,{pageId,inputUid,fileTickets}){
    if(!upload)throw Error("UPLOAD_BROKER_UNAVAILABLE");
    const target=await fileInputs(owner);
    if(target.pageId!==pageId)throw Error("UPLOAD_PAGE_NOT_SELECTED");
    const input=target.inputs?.find(i=>i.uid===inputUid);
    if(!input || input.disabled)throw Error("UPLOAD_INPUT_NOT_AVAILABLE");
    const files=await upload.resolve({owner,ticketIds:fileTickets,origin:target.origin});
    if(files.length>1 && !input.multiple)throw Error("UPLOAD_INPUT_NOT_MULTIPLE");
    // HTML accept is advisory to browsers but OWL should not bypass it silently.
    const specs=(input.accept||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
    for(const f of files) {
      if(specs.length && !specs.some(x=>
        x===f.mime.toLowerCase() ||
        (x.endsWith("/*")&&f.mime.toLowerCase().startsWith(x.slice(0,-1))) ||
        (x.startsWith(".")&&f.filename.toLowerCase().endsWith(x))
      ))throw Error("UPLOAD_ACCEPT_MISMATCH");
    }
    const result=await req(owner,"upload_file",{pageId,inputUid,origin:target.origin,files});
    return upload.recordSelection({owner,ticketIds:fileTickets,pageId,inputUid,result,origin:target.origin});
  }
  async function prepareDownload(owner,downloadId) {
    if(!upload)throw Error("UPLOAD_BROKER_UNAVAILABLE");
    const artifact=await req(owner,"download_artifact",{downloadId});
    if(!artifact?.completed||typeof artifact.localPath!=="string")
      throw Error("DOWNLOAD_NOT_COMPLETE");
    const target=await fileInputs(owner);
    return upload.prepare({owner,filePath:artifact.localPath,origin:target.origin});
  }
  return {
    open:(owner,url)=>req(owner,"open",{url}),
    tabs:owner=>req(owner,"tabs"),
    use:(owner,pageId)=>req(owner,"use",{pageId}),
    snapshot:owner=>req(owner,"snapshot"),
    fill:(owner,uid,value)=>req(owner,"fill",{uid,value}),
    editText:(owner,uid,value)=>req(owner,"edit_text",{uid,value}),
    pasteText:(owner,uid,text)=>req(owner,"paste_text",{uid,text}),
    dragDrop:(owner,sourceUid,targetUid)=>req(owner,"drag_drop",{sourceUid,targetUid}),
    p2Capabilities:owner=>req(owner,"p2_capabilities"),
    click:(owner,uid)=>req(owner,"click",{uid}),
    screenshot:owner=>req(owner,"screenshot"),
    focusForLogin:owner=>req(owner,"focus_login"),
    closeTab:(owner,pageId)=>req(owner,"close_tab",{pageId}),
    downloadStart:(owner,linkUid,requestId)=>req(owner,"download_start",{linkUid,requestId}),
    downloadStatus:(owner,downloadId)=>req(owner,"download_status",{downloadId}),
    downloadList:owner=>req(owner,"download_list"),
    downloadCancel:(owner,downloadId)=>req(owner,"download_cancel",{downloadId}),
    prepareDownload,
    receiptCheck:(owner,expectedText)=>req(owner,"receipt_check",{expectedText}),
    fileInputs,
    prepareFile,
    uploadFile,
    uploadStatus:(owner,uploadId)=>upload.status({owner,uploadId}),
    releaseFiles:(owner,tickets)=>upload.release({owner,ticketIds:tickets}),
    capabilities:()=>({transport:"chrome-native-messaging",
      fileUpload:upload?.capabilities()??{uploadFile:false},
      standardInput:true,hiddenInput:true,downloads:true,downloadToUpload:true,uiReceiptCheck:true,plainTextPaste:true,textDragDrop:true,fileDragDrop:false,osClipboard:false,nativePicker:false}),
    status:()=>broker.status(),
    close:async()=>{} // broker/upload lifecycle belongs to Connection Host
  };
}
