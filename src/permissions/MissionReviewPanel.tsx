import {useCallback, useEffect, useState} from "react";

type MissionReview = Awaited<ReturnType<typeof window.owlDesktop.listMissionReviews>>[number];
type ExecutionGrant = NonNullable<NonNullable<MissionReview["scope"]>["executionPermissions"]>[number];

const pathParts=(value:string)=>value.replace(/\\/g,"/").split("/").filter(Boolean);
const shortPath=(value:string)=>pathParts(value).slice(-3).join("/") || value;
const humanLabel=(value:string)=>value.replace(/[-_.]+/g," ");

function PermissionSwitch({checked, disabled, label, onToggle}: {
  checked:boolean;
  disabled?:boolean;
  label:string;
  onToggle:()=>void;
}) {
  return <button type="button" role="switch" aria-label={label}
    aria-checked={checked} disabled={disabled}
    className={"toggle mission-toggle"+(checked?" on":"")}
    onClick={onToggle}><span aria-hidden="true"/></button>;
}

export function MissionReviewCard({row, busy, onApprove, onRevoke}: {
  row:MissionReview;
  busy:boolean;
  onApprove:(row:MissionReview,enabledPermissionIds:string[])=>Promise<boolean>;
  onRevoke:(row:MissionReview)=>Promise<void>;
}) {
  const approved=row.status==="approved";
  const [draftOn,setDraftOn]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const active=approved||draftOn;
  const scope=row.scope;
  const grants=scope?.executionPermissions??[];
  const approvedIds=approved?row.enabledPermissionIds:[];
  const root=scope?.workspaceRoot;
  const valid=Boolean(root && scope?.allowedRepositories?.length &&
    scope.allowedRepositories.includes(pathParts(root).at(-1)??""));
  const currentIds=approved?approvedIds:selected;
  const toggleGrant=(id:string)=>{
    if(approved||busy)return;
    setDraftOn(true);
    setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
  };
  const cancelDraft=()=>{setDraftOn(false);setSelected([]);};
  const toggleMission=()=>{
    if(busy)return;
    if(approved) {void onRevoke(row);return;}
    if(draftOn)cancelDraft();
    else setDraftOn(true);
  };
  const approve=async()=>{
    if(!draftOn||approved||!valid||busy)return;
    const authorized=await onApprove(row,selected);
    if(authorized)cancelDraft();
  };
  return <article className={"mission-card"+(approved?" mission-card-approved":"")}
    aria-label={row.label||"Agent mission"}>
    <header className="mission-card-header">
      <div className="mission-card-heading">
        <div className="mission-card-title"><strong>{row.label||"Agent workstream"}</strong>
          <span className={"mission-state"+(approved?" active":"")}>
            {approved?"Enabled":draftOn?"Reviewing changes":"Off"}
          </span>
        </div>
        <p>{row.goal}</p>
      </div>
      <div className="mission-control">
        <span>{active?"On":"Off"}</span>
        <PermissionSwitch checked={active} disabled={busy||(!valid&&!approved)}
          label={(approved?"Turn off":"Turn on")+" mission authorization for "+(row.label||row.goal)}
          onToggle={toggleMission}/>
      </div>
    </header>
    <div className="mission-card-body">
      <div className="mission-permission-line">
        <div><strong>Workspace access</strong>
          <small title={root??undefined}>
            {root?shortPath(root):"No verified workspace — cannot authorize"}
          </small>
        </div>
        <span className="mission-mode">{active?"Selected":"Off"}</span>
      </div>
      {grants.map((grant:ExecutionGrant)=>
        <div key={grant.id} className="mission-permission-line">
          <div><strong>{humanLabel(grant.id)}</strong>
            <small>Run {shortPath(grant.executable)} · {grant.workspaceMode==="write"?"Write in selected folder":"Read only"}</small>
          </div>
          <div className="mission-control">
            <span>{currentIds.includes(grant.id)?"On":"Off"}</span>
            <PermissionSwitch checked={currentIds.includes(grant.id)}
              disabled={approved||busy||!valid}
              label={(currentIds.includes(grant.id)?"Turn off":"Turn on")+" process permission "+grant.id}
              onToggle={()=>toggleGrant(grant.id)}/>
          </div>
        </div>
      )}
      <details className="mission-details">
        <summary>Show exact permissions and commands</summary>
        <div className="mission-details-content">
          <strong>Allowed workspace</strong>
          <code>{root??"Not provided"}</code>
          <strong>Prohibited actions</strong>
          <ul>{(scope?.prohibitedChanges??[]).map((v,i)=><li key={i}>{v}</li>)}</ul>
          <strong>Acceptance criteria</strong>
          <ul>{(scope?.acceptanceCriteria??[]).map((v,i)=><li key={i}>{v}</li>)}</ul>
          {grants.map((grant:ExecutionGrant)=><div className="mission-command-details" key={grant.id}>
            <strong>{humanLabel(grant.id)}</strong>
            <small>Executable</small><code>{grant.executable}</code>
            <small>Working directory</small><code>{grant.cwd}</code>
            <small>Exact arguments</small><code>{JSON.stringify(grant.argv)}</code>
            <small>Writable roots proposed</small>
            {(grant.writableRoots.length?grant.writableRoots:["None"]).map((v,i)=><code key={i}>{v}</code>)}
            <small>Sandbox declared: {grant.sandbox.type} (not independently OS-verified)</small>
          </div>)}
        </div>
      </details>
      {!approved && draftOn && <div className="mission-inline-confirm">
        <div>
          <strong>Enable this mission?</strong>
          <p>Workspace permissions and {selected.length} of {grants.length} process permissions will be signed locally. Only selected process permissions can run. Other permissions stay off.</p>
        </div>
        <div className="mission-confirm-actions">
          <button type="button" className="secondary" onClick={cancelDraft} disabled={busy}>Cancel</button>
          <button type="button" onClick={()=>void approve()} disabled={busy||!valid}>
            {busy?"Authorizing…":"Confirm & enable"}
          </button>
        </div>
      </div>}
      {approved && <p className="mission-approval-hint">
        Turn off to revoke future access. Already running processes are not stopped automatically.
        To change individual permissions, turn off this mission and enable only what you need.
      </p>}
      {!valid && <p role="alert" className="mission-approval-error">Workspace is not valid for approval.</p>}
    </div>
  </article>;
}

export function MissionReviewPanel() {
  const [rows,setRows]=useState<MissionReview[]>([]);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const reload=useCallback(async()=>{
    const next=await window.owlDesktop.listMissionReviews();
    setRows(next);
  },[]);
  useEffect(()=>{
    let active=true;
    void reload().catch(()=>{if(active)setError("Mission permission status unavailable");});
    const timer=window.setInterval(()=>{
      void reload().catch(()=>{if(active)setError("Mission permission status unavailable");});
    },15000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[reload]);
  const ordered=[...rows].sort((a,b)=>
    Number(a.status==="approved")-Number(b.status==="approved"));
  const approve=async(row:MissionReview,enabledPermissionIds:string[])=>{
    setBusy(row.workstreamId);setError(null);
    try {
      await window.owlDesktop.approveMission(row.workstreamId,{
        confirmed:true,reviewDigest:row.reviewDigest,enabledPermissionIds,
      });
      await reload();
      return true;
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
      return false;
    }finally{setBusy(null);}
  };
  const revoke=async(row:MissionReview)=>{
    setBusy(row.workstreamId);setError(null);
    try{
      await window.owlDesktop.revokeMission(row.workstreamId);
      await reload();
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }finally{setBusy(null);}
  };
  return <section className="panel settings-panel mission-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">MISSION CONTROL</span><h3>Agent permissions</h3></div>
      <button className="secondary" onClick={()=>void reload().catch((e:unknown)=>setError(String(e)))}>Refresh</button>
    </div>
    <p className="panel-help">Choose permissions with the switches below. Everything is off until you explicitly confirm. Your selected scope is signed locally and can be revoked here at any time.</p>
    {error && <p role="alert" className="mission-approval-error">{error}</p>}
    {ordered.length===0
      ?<p className="panel-help">No missions need permission review.</p>
      :<div className="mission-card-list">
        {ordered.map(row=><MissionReviewCard key={row.workstreamId} row={row}
          busy={busy!==null} onApprove={approve} onRevoke={revoke}/>)}
      </div>}
  </section>;
}
