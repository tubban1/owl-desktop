// Payload-free, fail-closed snapshot for unattended release safety.
// This is a *deferral gate*, not a replacement for atomic Runtime draining.
export function evaluateOtaActivity({tasks,approvals,processes,inFlightTools} = {}) {
  const rows = v => Array.isArray(v) ? v :
    Array.isArray(v?.items) ? v.items :
    Array.isArray(v?.processes) ? v.processes :
    Array.isArray(v?.tasks) ? v.tasks :
    Array.isArray(v?.approvals) ? v.approvals : null;
  const t=rows(tasks),a=rows(approvals),p=rows(processes);
  if (!t || !a || !p || !Number.isSafeInteger(inFlightTools) || inFlightTools<0)
    return {ready:false,reason:"activity-unknown"};
  const activeTasks=t.filter(x => ["running","pending","waiting_approval",
    "needs_review","paused"].includes(String(x?.status||""))).length;
  const activeProcesses=p.filter(x=>x?.running===true ||
    ["running","terminating"].includes(String(x?.status||""))).length;
  const approvalsPending=a.filter(x=>["pending","requested","waiting"].includes(
    String(x?.state??x?.status??""))).length;
  const ready=activeTasks===0 && activeProcesses===0 &&
    approvalsPending===0 && inFlightTools===0;
  return {ready,reason:ready?"quiet":"runtime-or-mcp-work-active",
    activeTasks,activeProcesses,approvalsPending,inFlightTools};
}
