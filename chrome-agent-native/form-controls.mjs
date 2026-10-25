// A SINGLE self-contained injected function. Chrome serializes func source
// into the selected tab, so no module-scoped helper references are allowed.
export function executeFormAction(mode,args={}){
  const {origin,uid,change,pageUrl,submitUid,salary,notice,referralValue}=args;
  if(location.origin!==origin)return {error:"FORM_ORIGIN_CHANGED"};
  const seek=(id)=>{
    const selector='[data-owl-agent-control="'+CSS.escape(id)+'"]';
    const walk=(root,depth=0)=>{
      if(depth>8)return null;
      const hit=root.querySelector(selector);
      if(hit)return hit;
      for(const host of root.querySelectorAll("*")){
        if(host.shadowRoot){const found=walk(host.shadowRoot,depth+1);if(found)return found;}
      }
      return null;
    };
    return walk(document);
  };
  const safe=(el)=>{
    if(!el||el.disabled||el.readOnly)return false;
    const metadata=((el.getAttribute("type")||"")+" "+(el.getAttribute("name")||"")).toLowerCase();
    return !/password|secret|passkey|otp|one.time|credit|cvv|token|api.?key/.test(metadata);
  };
  const labeled=(el)=>{
    const labels=Array.from(el.labels||[]).map(x=>x.innerText||x.textContent||"");
    return (labels.join(" ")||el.getAttribute("aria-label")||
      el.parentElement?.textContent||"").trim().slice(0,240);
  };
  if(mode==="inspect"){
    const rows=[];
    for(const el of document.querySelectorAll("input,select,textarea")){
      const id=el.getAttribute("data-owl-agent-control");
      const type=(el.getAttribute("type")||el.tagName).toLowerCase();
      if(!id||!safe(el)||!["radio","checkbox","number","text","email","tel","textarea"].includes(type))
        continue;
      rows.push({uid:id,type,name:el.name||"",label:labeled(el),
        checked:["radio","checkbox"].includes(type)?!!el.checked:undefined,
        value:["radio","number"].includes(type)?String(el.value).slice(0,120):undefined,
        required:!!el.required});
      if(rows.length>=100)break;
    }
    return {origin,pageUrl:location.href,controls:rows};
  }
  if(mode==="set"){
    if(!/^owl-agent-\d{1,3}$/.test(uid||"")||!change||typeof change!=="object")
      return {error:"FORM_FIELD_ARGUMENTS_INVALID"};
    const el=seek(uid);
    if(!el)return {error:"AGENT_SNAPSHOT_STALE"};
    if(!safe(el))return {error:"SENSITIVE_OR_INVALID_FIELD"};
    const type=(el.getAttribute("type")||"").toLowerCase();
    if(type==="radio"||type==="checkbox"){
      if(typeof change.checked!=="boolean"||(type==="radio"&&!change.checked))
        return {error:"FORM_BOOLEAN_REQUIRED"};
      if(type==="radio"&&String(change.expectedValue)!==String(el.value))
        return {error:"FORM_OPTION_VALUE_MISMATCH"};
      if(el.checked!==change.checked)el.click();
      if(el.checked!==change.checked)return {error:"FORM_CHECKED_POSTCONDITION_FAILED"};
      return {uid,name:el.name||"",type,checked:!!el.checked,domVerified:true,websitePersisted:false};
    }
    if(type==="number"){
      const value=String(change.value??"");
      if(!/^\d{1,10}$/.test(value))return {error:"FORM_NUMBER_INVALID"};
      const min=el.min===""?null:Number(el.min),max=el.max===""?null:Number(el.max);
      if((min!==null&&Number(value)<min)||(max!==null&&Number(value)>max))
        return {error:"FORM_NUMBER_OUT_OF_RANGE"};
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,value);
      el.dispatchEvent(new Event("input",{bubbles:true}));
      el.dispatchEvent(new Event("change",{bubbles:true}));
      if(el.value!==value)return {error:"FORM_NUMBER_POSTCONDITION_FAILED"};
      return {uid,name:el.name||"",type,value:el.value,domVerified:true,websitePersisted:false};
    }
    return {error:"FORM_FIELD_TYPE_UNSUPPORTED"};
  }
  if(mode!=="review"&&mode!=="submit")return {error:"FORM_MODE_INVALID"};
  if(location.href!==pageUrl||!/^owl-agent-\d{1,3}$/.test(submitUid||""))
    return {error:"FORM_SUBMISSION_TARGET_CHANGED"};
  const submit=seek(submitUid);
  if(!submit||submit.tagName!=="INPUT"||submit.type!=="submit"||
     !submit.form||!safe(submit))return {error:"FORM_SUBMIT_TARGET_NOT_VERIFIED"};
  const form=submit.form;
  const incomplete=Array.from(form.elements).filter(el=>el.required&&!el.disabled&&
    ((el.type==="checkbox"&&!el.checked)||
     (el.type==="radio"&&!Array.from(form.elements).some(x=>x.name===el.name&&x.checked))||
     (el.type!=="checkbox"&&el.type!=="radio"&&!String(el.value||"").trim())))
    .map(el=>el.name||el.type).slice(0,16);
  const consent=form.querySelector('input[name="candidate[consent_given]"]');
  const retention=form.querySelector('input[name="candidate[consent_given_future_jobs]"]');
  const annualSalary=form.querySelector('input[name="candidate[answers_attributes][2][number]"]');
  const available=form.querySelector('input[name="candidate[answers_attributes][5][text]"]');
  const referred=Array.from(form.querySelectorAll('input[name="candidate[answers_attributes][0][choice]"]'))
    .find(el=>el.checked);
  const cvText=(form.innerText||form.textContent||"").slice(0,30000);
  const review={pageUrl:location.href,origin,submitUid,
    ready:incomplete.length===0&&consent?.checked===true&&retention?.checked!==true&&
      !!referred?.value&&!!annualSalary?.value&&!!available?.value&&
      cvText.includes("Liang_Rao_Axpo_GenAI_Product_Manager_CV.pdf"),
    requiredMissing:[...new Set(incomplete)],salary:annualSalary?.value||null,
    notice:available?.value||null,referralValue:referred?.value||null,
    referralLabel:referred?labeled(referred):null,
    consentChecked:consent?.checked===true,optionalRetention:retention?.checked===true,
    cvAttached:cvText.includes("Liang_Rao_Axpo_GenAI_Product_Manager_CV.pdf"),
    siteConfirmed:false};
  if(mode==="review")return review;
  if(!review.ready||review.salary!==String(salary)||review.notice!==String(notice)||
     review.referralValue!==String(referralValue))
    return {error:"FORM_APPROVAL_DETAILS_MISMATCH",review};
  // Respect native validation and the site's event listeners.
  // Never use form.submit(), which bypasses validation and events.
  form.requestSubmit(submit);
  return {dispatched:true,siteConfirmed:false,review};
}
