import { useCallback, useEffect, useState } from "react";

type MissionReview = Awaited<ReturnType<typeof window.owlDesktop.listMissionReviews>>[number];

export function MissionReviewPanel() {
  const [rows, setRows] = useState<MissionReview[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const next = await window.owlDesktop.listMissionReviews();
    setRows(next);
  }, []);
  useEffect(() => {
    let active = true;
    void reload().catch(() => { if (active) setError("Mission review status unavailable"); });
    const timer = window.setInterval(() => {
      void reload().catch(() => { if (active) setError("Mission review status unavailable"); });
    }, 15000);
    return () => {active=false;window.clearInterval(timer);};
  }, [reload]);
  const pending = rows.filter((item) => item.status === "needs_review");
  const approved = rows.filter((item) => item.status === "approved").length;
  return <section className="panel settings-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">MISSION CONTROL</span><h3>Agent mission boundaries</h3></div>
      <button className="secondary" onClick={() => void reload().catch((e:unknown) => setError(String(e)))}>Refresh</button>
    </div>
    <p className="panel-help">Only approve a workstream when its original goal, exact workspace and prohibited changes match your request. Approval is signed locally using your OS-protected key. It never bypasses Runtime file, shell or deletion permissions. Raw shell and opaque tasks remain blocked in restricted missions.</p>
    {error && <p role="alert">{error}</p>}
    {pending.length === 0 ? <p className="panel-help">No restricted missions await review. {approved} confirmed in recent workstreams.</p> : pending.map((row) =>
      <div className="setting-row" key={row.workstreamId}>
        <div style={{minWidth:0}}>
          <strong>{row.label || "Agent workstream"}</strong>
          <span>{row.goal}</span>
          <span>Root: {row.scope?.workspaceRoot || "Not provided — cannot approve"}</span>
          <span>Allowed: {row.scope?.allowedRepositories?.join(", ") || "None"}</span>
          <span>Prohibited: {row.scope?.prohibitedChanges?.join("; ") || "None declared"}</span>
          <span>Process permissions: {row.scope?.executionPermissions?.length ?? 0} (exact executable, arguments and writable roots shown in confirmation)</span>
          <small>{row.reason}{row.pendingProgressBoundary ? " · Waiting for progress acknowledgement" : ""}</small>
        </div>
        <button className="secondary"
          disabled={busy!==null || !row.scope?.workspaceRoot}
          onClick={async()=> {
            setBusy(row.workstreamId);setError(null);
            try {
              await window.owlDesktop.approveMission(row.workstreamId);
              await reload();
            } catch(e) {setError(e instanceof Error ? e.message : String(e));}
            finally {setBusy(null);}
          }}>
          {busy===row.workstreamId ? "Reviewing..." : "Review mission"}
        </button>
      </div>)}
  </section>;
}
