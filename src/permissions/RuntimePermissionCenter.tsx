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
 const refresh=async()=>setData(await window.owlDesktop.getRuntimePermissions());
 useEffect(()=>{void refresh().catch(e=>setMessage(String(e)));},[]);
 const change=async(key:RuntimePermissionKey,mode:"blocked"|"review"|"enabled")=>{
  setBusy(true);setMessage("");
  try{
   const result=await window.owlDesktop.setRuntimePermission(key,mode);
   setData(result);
   setMessage(result.changed===false?"Cancelled; no permission changed.":
    "Saved. A separate Runtime restart is required; this does not authorize any action.");
  }
  catch(e){setMessage(String(e));}finally{setBusy(false);}
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
  <p className="panel-help">Git Push is enabled by default and does not need per-action approval. Delete, rollback and high-risk reviewed actions remain separately controlled. Cloud lease and workspace scope still apply.</p>
  <div className="about-grid">
   <span>Connected Runtime</span><code>{endpoint??"Unavailable"}</code>
   <span>Device authorization</span><strong>{access?.state??"Unknown"} · {access?.reasonCode??"Not checked"}</strong>
   <span>Lease expires</span><strong>{access?.grant?.expiresAt?new Date(access.grant.expiresAt).toLocaleString():"Unknown"}</strong>
   <span>Live process flags</span><strong>Not proven by stored settings; verify provider status</strong>
  </div>
  {data?.items.map(item=><div className="setting-row" key={item.key}>
   <div><strong>{item.label} ({item.envName})</strong>
    <span>Desktop config: {item.configured?"Enabled":"Disabled"} · {item.configuredSource}{item.pendingApply?" · Pending restart":""}</span>
    <span>{item.key==="gitPush"?
      "Git Push: enabled by default, no per-push approval. Manual Blocked setting overrides this.":
      "Connected Runtime: unverified. Reviewed actions still need separate approval."}</span></div>
   <select className="setting-input compact-input" value={item.mode} disabled={busy}
    onChange={e=>{const mode=e.target.value;if(mode==="blocked"||mode==="review"||mode==="enabled")void change(item.key,mode);}}>
    {item.mode==="inherit"&&<option value="inherit">{item.key==="gitPush"?"Enabled (default)":"Inherited setting"}</option>}
    {item.key==="gitPush"?<>
      <option value="enabled">Enabled · no approval</option><option value="blocked">Blocked</option>
    </>:<>
      <option value="blocked">Blocked</option><option value="review">Review each action</option>
    </>}
   </select>
  </div>)}
  {message&&<p className="panel-help">{message}</p>}
  <div className="runtime-version">
   <button className="secondary" disabled={busy||!data?.restartRequired} onClick={()=>void apply()}>Apply and restart managed Runtime</button>
   <span className={"neutral-pill "+(data?.restartRequired?"warning-pill":"")}>
    {data?.restartRequired?"Saved setting differs from runtime.env":"No pending managed config changes"}</span>
  </div>
  <p className="panel-help">Development sessions may connect to another Runtime. This page never restarts unrelated processes or bypasses a locked lease, missing folder, or busy workspace.</p>
  <p className="panel-help">For reviewed Shell, Delete or Rollback operations, inspect the originating Task and exact target before approving. Git Push is intentionally not part of routine human review.</p>
  <ApprovalAttention approvals={approvals} onApprove={onApprove} onDeny={onDeny}/>
 </section>;
}
