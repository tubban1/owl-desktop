import {useEffect,useState} from "react";
import {RefreshCw} from "lucide-react";
import type {RuntimeAccessState,RuntimePermissionKey,RuntimePermissionProjection} from "../types";
import {ApprovalAttention} from "../approvals/ApprovalAttention";
export function RuntimePermissionCenter({approvals,access,endpoint,onApprove,onDeny}:{
 approvals:unknown;access:RuntimeAccessState|null;endpoint?:string;
 onApprove(id:string):Promise<void>;onDeny(id:string):Promise<void>;
}){
 const [data,setData]=useState<RuntimePermissionProjection|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [helper,setHelper]=useState<{platform:string;helperMode:string;helperInstalled:boolean;nativeInput:boolean;clipboard:boolean}|null>(null);
 const [helperStatus,setHelperStatus]=useState("Not checked");
 const [pendingMode,setPendingMode]=useState<{key:RuntimePermissionKey;mode:"blocked"|"review"|"enabled"}|null>(null);
 const refresh=async()=>{
   const permission=await window.owlDesktop.getRuntimePermissions();setData(permission);
   try{
     const inventory=await window.owlDesktop.skillSnapshot();
     const provider=inventory.providers.find(item=>item.id==="desktop");
     const details=provider?.details as Record<string,unknown>|undefined;
     if(!provider||!details){setHelper(null);setHelperStatus("Desktop provider status unavailable");return;}
     setHelper({platform:String(details.platform??"unknown"),
       helperMode:String(details.helperMode??"unknown"),
       helperInstalled:details.helperInstalled===true,
       nativeInput:details.nativeInput===true,
       clipboard:details.clipboard===true});
     setHelperStatus("Live Runtime provider snapshot");
   }catch{setHelper(null);setHelperStatus("Runtime provider query failed · unverified");}
 };
 useEffect(()=>{void refresh().catch(e=>setMessage(String(e)));},[]);
 const change=async(key:RuntimePermissionKey,mode:"blocked"|"review"|"enabled")=>{
  setBusy(true);setMessage("");setPendingMode({key,mode});
  try{
   const result=await window.owlDesktop.setRuntimePermission(key,mode);
   setData(result);
   setMessage(result.changed===false?"Cancelled; no permission changed.":
    result.restartRequired?"Saved, NOT ACTIVE: apply to the managed Runtime and confirm the connected Runtime before trying this action. No approval has been granted.":
    result.liveRuntimeEffective==="verified"?"Saved and verified against the running Runtime.":
    "Saved. Connected Runtime policy still needs verification; no action has been approved.");
  }
  catch(e){setMessage(String(e));}finally{setPendingMode(null);setBusy(false);}
 };
 const apply=async()=>{
  setBusy(true);setMessage("");
  try{
   const result=await window.owlDesktop.applyRuntimePermissions();
   setMessage(result.applied?"Runtime restarted. Verify provider status.":result.reason==="DEV_FULL_RESTART_REQUIRED"?
    "Development mode: restart dev:full deliberately. The packaged Runtime was not changed.":
    result.reason==="CANCELLED"?"No changes applied.":String(result.reason));
   await refresh();
  }catch(e){setMessage(String(e));}finally{setBusy(false);}
 };
 return <section className="panel settings-panel">
  <div className="panel-heading"><div><span className="eyebrow">RUNTIME PERMISSIONS</span><h3>Permission center</h3></div>
   <button className="secondary" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15}/>Refresh</button></div>
  <p className="panel-help">Configure permissions by category. On allows authorized operations; Off refuses; Ask requires signed approval where Runtime supports it. File writes currently support On / Off only. Changes apply only to the selected managed Runtime after restart and verification.</p>
  {data?.installedRuntimeSupportsReview===false&&data.items.some(item=>item.mode==="review")&&<p role="alert" className="inline-warning">Your installed Runtime cannot provide signed per-action Review. This is a version incompatibility, not a request to enable ALLOW_DELETE globally. Upgrade to a compatible managed Runtime before applying Review.</p>}
  {data?.restartRequired&&<p role="alert" className="inline-warning">Review/permission changes are NOT active. A saved preference alone cannot authorize an action. Apply the settings to the actual managed Runtime and verify it is running the new policy.</p>}
  {data?.message&&<p className="panel-help">{data.message}</p>}
  <div className="about-grid">
   <span>Connected Runtime</span><code>{endpoint??"Unavailable"}</code>
   <span>Device authorization</span><strong>{access?.state??"Unknown"} · {access?.reasonCode??"Not checked"}</strong>
   <span>Lease expires</span><strong>{access?.grant?.expiresAt?new Date(access.grant.expiresAt).toLocaleString():"Unknown"}</strong>
   <span>Live process flags</span><strong>{data?.liveRuntimeEffective==="verified"?"Verified managed Runtime policy snapshot":"Unverified · no effective permission claim"}</strong>
  </div>
  {[
    {title:"Files & folders",keys:["write","delete"]},
    {title:"Commands & processes",keys:["shell"]},
    {title:"Git & recovery",keys:["gitPush","rollback"]},
  ].map(group=><div key={group.title}>
   <div className="setting-group-label"><span>{group.title}</span></div>
   {data?.items.filter(item=>group.keys.includes(item.key)).map(item=><div className="setting-row" key={item.key}>
    <div><strong>{item.label} ({item.envName})</strong>
     <span>{item.pendingApply?"未生效 · NOT APPLIED":
       data?.liveRuntimeEffective==="verified"?"已生效 · "+(item.mode==="review"?"询问 · Ask":item.mode==="enabled"?"打开 · On":"关闭 · Off"):
       "设置已保存 · 运行状态未验证"} · {data?.source??item.configuredSource}</span>
     <span>{item.mode==="review"?
       item.pendingApply?"询问模式尚未生效；不会绕过权限执行。":
       data?.liveRuntimeEffective==="verified"?"底层开关保持关闭，仅在本次操作获得有效签名批准后临时授权。":
       "询问模式：底层开关保持关闭，等待运行时验证。":
       "运行时底层开关："+(item.configured?"On":"Off")}</span>
     {item.supportsReview===false&&<span>此能力的 Runtime 尚未支持逐操作签名授权；只提供 On / Off，不会用假 Ask 绕过安全机制。</span>}
    </div>
    <select className="setting-input compact-input" value={pendingMode?.key===item.key?pendingMode.mode:item.mode} disabled={busy}
     onChange={e=>{const mode=e.target.value;if(mode==="blocked"||mode==="review"||mode==="enabled")void change(item.key,mode);}}>
     <option value="enabled">打开 · On</option>
     <option value="blocked">关闭 · Off</option>
     {item.supportsReview!==false&&<option value="review">询问 · Ask each action</option>}
    </select>
   </div>)}
  </div>)}
  <div className="setting-group-label"><span>Browser & desktop input</span></div>
  <p className="panel-help">Browser text input uses Chrome tab-scoped trusted input, independently of Windows native keyboard control. The OS Helper requires a separate installed, consented implementation; changing file or Shell permissions cannot activate it.</p>
  <div className="about-grid">
   <span>Runtime capability source</span><strong>{helperStatus}</strong>
   <span>OS platform</span><strong>{helper?.platform??"Unknown"}</strong>
   <span>Windows Helper</span><strong>{!helper?"Not verified":helper.platform!=="win32"?"Not applicable":helper.helperInstalled?helper.helperMode+" · installed":"Not installed"}</strong>
   <span>Native keyboard input</span><strong>{!helper?"Unverified":helper.nativeInput?"Available":"Unavailable · no approved native input"}</strong>
   <span>OS clipboard</span><strong>{!helper?"Unverified":helper.clipboard?"Available":"Unavailable"}</strong>
  </div>
  {pendingMode&&<p role="status" className="panel-help">Pending confirmation: {pendingMode.key} → {pendingMode.mode==="enabled"?"打开":pendingMode.mode==="blocked"?"关闭":"询问"}. This does not change the running Runtime.</p>}
  {message&&<p role="status" className="panel-help">{message}</p>}
  <div className="runtime-version">
   <button className="secondary" disabled={busy||!data?.restartRequired} onClick={()=>void apply()}>Apply and restart managed Runtime</button>
   <span className={"neutral-pill "+(data?.restartRequired?"warning-pill":"")}>
    {data?.restartRequired?"Saved policy not active":data?.liveRuntimeEffective==="verified"?"已生效 · 运行时已验证":"Policy on disk matches · live state unverified"}</span>
  </div>
  <p className="panel-help">Development sessions may connect to another Runtime. This page never restarts unrelated processes or bypasses a locked lease, missing folder, or busy workspace.</p>
  <p className="panel-help">For reviewed Git Push, Shell, Delete and Rollback operations, inspect the originating Task and exact target before approving. A review request only appears after the connected Runtime has loaded the signed policy and produced a pending action.</p>
  <ApprovalAttention approvals={approvals} onApprove={onApprove} onDeny={onDeny}/>
 </section>;
}
