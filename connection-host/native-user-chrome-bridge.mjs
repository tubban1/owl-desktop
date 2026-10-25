import {currentUploadScope} from "./agent-upload-policy.mjs";
export function createNativeChromeBridge({broker,uploadBroker,submissionGrantReader=currentUploadScope}) {
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
  async function dropFiles(owner,{pageId,targetUid,fileTickets}){
    if(!upload)throw Error("UPLOAD_BROKER_UNAVAILABLE");
    const tab=await req(owner,"snapshot");
    if(tab?.pageId!==pageId)throw Error("FILE_DROP_PAGE_NOT_SELECTED");
    const url=tab.snapshot?.url;
    if(!url)throw Error("FILE_DROP_PAGE_NOT_AVAILABLE");
    const origin=new URL(url).origin;
    const target=tab.snapshot?.controls?.find(x=>x.uid===targetUid);
    if(!target)throw Error("FILE_DROP_TARGET_NOT_OBSERVED");
    const files=await upload.resolve({owner,ticketIds:fileTickets,origin});
    const result=await req(owner,"drop_files",{pageId,targetUid,origin,files});
    return upload.recordDrop({owner,ticketIds:fileTickets,pageId,targetUid,result,origin});
  }
  async function prepareDownload(owner,downloadId) {
    if(!upload)throw Error("UPLOAD_BROKER_UNAVAILABLE");
    const artifact=await req(owner,"download_artifact",{downloadId});
    if(!artifact?.completed||typeof artifact.localPath!=="string")
      throw Error("DOWNLOAD_NOT_COMPLETE");
    const target=await fileInputs(owner);
    return upload.prepare({owner,filePath:artifact.localPath,origin:target.origin});
  }
  const approvedGrantFor=(pageUrl)=>{
    let grant=null;
    try{grant=JSON.parse(submissionGrantReader("OWL_AGENT_FORM_SUBMISSION_GRANT")||"null");}
    catch{throw Error("FORM_SUBMISSION_GRANT_INVALID");}
    if(grant?.pageUrl!==pageUrl||grant.approvedByUser!==true||
       !Number.isFinite(Date.parse(grant.expiresAt))||
       Date.parse(grant.expiresAt)<=Date.now()||
       Date.parse(grant.expiresAt)>Date.now()+60*60*1000)
      throw Error("FORM_LEGAL_CONSENT_REQUIRES_USER_GRANT");
    return grant;
  };
  async function formSetApproved(owner,uid,change){
    const info=await req(owner,"form_controls");
    const row=info.controls?.find(x=>x.uid===uid);
    if(!row)throw Error("FORM_CONTROL_NOT_IN_LATEST_SNAPSHOT");
    if(row.type==="checkbox"&&/consent|privacy|agree|retention|policy/i.test(row.name+" "+row.label)){
      const grant=approvedGrantFor(info.pageUrl);
      if(/future_jobs|retain|retention/i.test(row.name+" "+row.label)){
        if(change.checked!==false||grant.optionalRetention!==false)
          throw Error("FORM_OPTIONAL_RETENTION_NOT_APPROVED");
      }else if(change.checked!==true||grant.requiredConsent!==true)
        throw Error("FORM_LEGAL_CONSENT_REQUIRES_USER_GRANT");
    }
    if(row.type==="number"&&row.name==="candidate[answers_attributes][2][number]"){
      const grant=approvedGrantFor(info.pageUrl);
      if(String(change.value)!==grant.salary)throw Error("FORM_SALARY_NOT_APPROVED");
    }
    return req(owner,"form_set",{uid,change});
  }
  // Compatibility with the already-published browser_agent_fill/click tools:
  // route explicitly user-approved forms through the exact same guarded
  // Native Messaging workflow while new MCP tool discovery propagates.
  async function compatibleFill(owner,uid,value){
    const snap=await req(owner,"snapshot");
    const control=snap.snapshot?.controls?.find(x=>x.uid===uid);
    if(!control)throw Error("FORM_CONTROL_NOT_IN_LATEST_SNAPSHOT");
    if(["radio","checkbox","number"].includes(control.type)){
      const info=await req(owner,"form_controls");
      const row=info.controls?.find(x=>x.uid===uid);
      if(!row)throw Error("FORM_CONTROL_NOT_IN_LATEST_SNAPSHOT");
      let change;
      if(row.type==="number")change={value:String(value)};
      else if(row.type==="checkbox"){
        if(value!=="true"&&value!=="false")throw Error("FORM_BOOLEAN_REQUIRED");
        change={checked:value==="true"};
      }else{
        const requested=String(value).trim().toLowerCase();
        if(!["no","yes"].includes(requested)||
           row.label.trim().toLowerCase()!==requested)
          throw Error("FORM_RADIO_LABEL_MISMATCH");
        if(requested!=="no")throw Error("FORM_REFERRAL_APPROVAL_MISSING");
        change={checked:true,expectedValue:row.value};
      }
      return formSetApproved(owner,uid,change);
    }
    return req(owner,"fill",{uid,value});
  }
  async function compatibleClick(owner,uid){
    const snap=await req(owner,"snapshot");
    const control=snap.snapshot?.controls?.find(x=>x.uid===uid);
    if(control?.tag==="input"&&control.type==="submit"){
      const grant=approvedGrantFor(snap.snapshot.url);
      if(grant.requiredConsent!==true||grant.optionalRetention!==false)
        throw Error("FORM_SUBMISSION_REQUIRES_SCOPED_USER_GRANT");
      const review=await req(owner,"form_review",{pageUrl:snap.snapshot.url,submitUid:uid});
      // Caller cannot change the values by passing tool arguments: use
      // exactly the values confirmed in the local, user-owned grant.
      return submitReviewed(owner,{pageUrl:snap.snapshot.url,submitUid:uid,
        salary:grant.salary,notice:grant.notice,
        referralValue:review.referralValue});
    }
    return req(owner,"click",{uid});
  }
  const usedGrants=new Set();
  async function submitReviewed(owner,{pageUrl,submitUid,salary,notice,referralValue}){
    if(typeof pageUrl!=="string"||typeof salary!=="string"||
       typeof notice!=="string"||typeof referralValue!=="string")
      throw Error("FORM_SUBMIT_ARGUMENTS_INVALID");
    // A narrowly scoped, independently configurable OS-user approval is
    // required. Agent tools cannot create grants; use explicit local settings.
    let grant=null;
    try{grant=JSON.parse(submissionGrantReader("OWL_AGENT_FORM_SUBMISSION_GRANT")||"null");}
    catch{throw Error("FORM_SUBMISSION_GRANT_INVALID");}
    if(grant?.pageUrl!==pageUrl || grant.salary!==salary ||
       grant.notice!==notice||
       grant.optionalRetention!==false||grant.requiredConsent!==true||
       grant.approvedByUser!==true||
       !Number.isFinite(Date.parse(grant.expiresAt)) ||
       Date.parse(grant.expiresAt)<=Date.now() ||
       Date.parse(grant.expiresAt)>Date.now()+60*60*1000)
      throw Error("FORM_SUBMISSION_REQUIRES_SCOPED_USER_GRANT");
    if(!pageUrl.startsWith("https://") ||
       new URL(pageUrl).hostname!== "careers.axpo.com" ||
       !new URL(pageUrl).pathname.startsWith("/jobs/"))
      throw Error("FORM_SUBMISSION_TARGET_NOT_ALLOWLISTED");
    const grantKey=JSON.stringify([owner,pageUrl,grant.salary,grant.notice,grant.referralValue]);
    if(usedGrants.has(grantKey))throw Error("FORM_SUBMISSION_GRANT_ALREADY_USED");
    const review=await req(owner,"form_review",{pageUrl,submitUid});
    const referralMatches=review.referralValue===referralValue &&
      (grant.referralValue===referralValue ||
       (grant.referralValue==="no"&&String(review.referralLabel||"").trim().toLowerCase()==="no"));
    if(!review.ready||review.salary!==salary||review.notice!==notice ||
       !referralMatches||!review.consentChecked ||
       review.optionalRetention||!review.cvAttached)
      throw Error("FORM_SUBMISSION_PREVIEW_MISMATCH");
    usedGrants.add(grantKey); // fail closed: no automatic retry
    const dispatched=await req(owner,"form_submit",{pageUrl,submitUid,salary,notice,referralValue});
    return {...dispatched,submittedToSiteNotVerified:true,
      grantConsumed:true,detailsReviewed:true};
  }
  return {
    open:(owner,url)=>req(owner,"open",{url}),
    tabs:owner=>req(owner,"tabs"),
    use:(owner,pageId)=>req(owner,"use",{pageId}),
    snapshot:owner=>req(owner,"snapshot"),
    fill:compatibleFill,
    formControls:owner=>req(owner,"form_controls"),
    formSet:formSetApproved,
    formReview:(owner,pageUrl,submitUid)=>req(owner,"form_review",{pageUrl,submitUid}),
    submitReviewed,
    editText:(owner,uid,value)=>req(owner,"edit_text",{uid,value}),
    richEditorInsert:(owner,uid,value)=>req(owner,"rich_editor_insert",{uid,value}),
    pasteText:(owner,uid,text)=>req(owner,"paste_text",{uid,text}),
    dragDrop:(owner,sourceUid,targetUid)=>req(owner,"drag_drop",{sourceUid,targetUid}),
    p2Capabilities:owner=>req(owner,"p2_capabilities"),
    click:compatibleClick,
    cursorMove:(owner,uid)=>req(owner,"cursor_move",{uid}),
    cursorClick:(owner,uid)=>req(owner,"cursor_click",{uid}),
    cursorHide:owner=>req(owner,"cursor_hide"),
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
    dropFiles,
    uploadStatus:(owner,uploadId)=>upload.status({owner,uploadId}),
    releaseFiles:(owner,tickets)=>upload.release({owner,ticketIds:tickets}),
    capabilities:()=>({transport:"chrome-native-messaging",
      fileUpload:upload?.capabilities()??{uploadFile:false},
      standardInput:true,hiddenInput:true,downloads:true,downloadToUpload:true,uiReceiptCheck:true,plainTextPaste:true,textDragDrop:true,fileDragDrop:true,fileDragDropBackend:"chrome_debugger_cdp",osClipboard:false,nativePicker:false,tabLocalVirtualCursor:true,
      systemPointerShared:false,trustedTabMouseEvents:true,nativeDialogRequiresHuman:true}),
    status:()=>broker.status(),
    close:async()=>{} // broker/upload lifecycle belongs to Connection Host
  };
}
