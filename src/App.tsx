import { useEffect, useMemo, useState } from "react";
import {
  Activity, Boxes, CheckCircle2, Cloud, Cpu, Gauge, HardDrive,
  KeyRound, ListTree, Plus, RefreshCw, Settings2, ShieldCheck,
  Terminal, Trash2, Wifi, WifiOff, UserRound, Link2, Puzzle, Inbox,
  AlertTriangle,
} from "lucide-react";
import type { AccountMeta, AgentRequest, DesktopEnvironment, RuntimeSnapshot, SecretMeta, Settings } from "./types";
import { SkillsPage } from "./skills/SkillsPage";

type Page = "overview" | "sessions" | "agent-inbox" | "logs" | "runtime" | "skills" | "accounts" | "secrets" | "settings";

const nav = [
  { id: "overview" as Page, label: "Overview", icon: Gauge },
  { id: "sessions" as Page, label: "Sessions", icon: ListTree },
  { id: "agent-inbox" as Page, label: "Agent Inbox", icon: Inbox },
  { id: "logs" as Page, label: "Live Logs", icon: Terminal },
  { id: "runtime" as Page, label: "Runtime", icon: Boxes },
  { id: "skills" as Page, label: "Skills", icon: Puzzle },
  { id: "accounts" as Page, label: "Accounts", icon: UserRound },
  { id: "secrets" as Page, label: "Secrets", icon: KeyRound },
  { id: "settings" as Page, label: "Settings", icon: Settings2 },
];

const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
const formatTime = (value?: string) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

function Toggle({ checked, onChange }: { checked: boolean; onChange(v: boolean): void }) {
  return <button className={"toggle " + (checked ? "on" : "")} onClick={() => onChange(!checked)} aria-pressed={checked}><span /></button>;
}

function StatusPill({ online }: { online: boolean }) {
  return <span className={"status-pill " + (online ? "online" : "offline")}>{online ? <Wifi size={13} /> : <WifiOff size={13} />}{online ? "Connected" : "Offline"}</span>;
}

function MetricCard({ label, value, caption, icon: Icon }: { label: string; value: string | number; caption: string; icon: typeof Activity }) {
  return <div className="metric-card"><div className="metric-icon"><Icon size={18} /></div><div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-caption">{caption}</div></div></div>;
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="section-header"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [env, setEnv] = useState<DesktopEnvironment | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [accounts, setAccounts] = useState<AccountMeta[]>([]);
  const [agentRequests, setAgentRequests] = useState<AgentRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [secretDraft, setSecretDraft] = useState({ name: "", project: "global", value: "" });
  const [accountDraft, setAccountDraft] = useState({
    service: "",
    label: "",
    identifier: "",
    authMethod: "password" as AccountMeta["authMethod"],
    secret: "",
  });
  const [notice, setNotice] = useState("");
  const [logLevel, setLogLevel] = useState<"all" | "warn" | "error">("all");
  const [logSource, setLogSource] = useState("all");
  const [logQuery, setLogQuery] = useState("");

  const online = snapshot?.mode === "live";
  const cloudOnline = snapshot?.cloud.status === "connected";
  const cloudStatusLabel = snapshot?.cloud.status
    ? snapshot.cloud.status.replaceAll("_", " ")
    : "stopped";

  const refresh = async () => {
    setBusy(true);
    try {
      await window.owlDesktop.runtimeEventSync().catch(() => undefined);
      const [nextSnapshot, nextAgentRequests] = await Promise.all([
        window.owlDesktop.refreshRuntime(),
        window.owlDesktop.listAgentRequests({ limit: 100 }),
      ]);
      setSnapshot(nextSnapshot);
      setAgentRequests(nextAgentRequests);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    Promise.all([
      window.owlDesktop.environment(),
      window.owlDesktop.getSettings(),
      window.owlDesktop.listSecrets(),
      window.owlDesktop.listAccounts(),
      window.owlDesktop.listAgentRequests({ limit: 100 }),
    ]).then(([nextEnv, nextSettings, nextSecrets, nextAccounts, nextAgentRequests]) => {
      setEnv(nextEnv);
      setSettings(nextSettings);
      setSecrets(nextSecrets);
      setAccounts(nextAccounts);
      setAgentRequests(nextAgentRequests);
      if (nextSettings.autoConnectRuntime) void refresh();
    });
  }, []);

  const runtimeVersion = snapshot?.info?.runtimeVersion ?? "Not connected";
  const apiVersion = snapshot?.info?.apiVersion ?? "—";
  const sessionShort = settings?.sessionId ? settings.sessionId.slice(0, 22) + "…" : "—";

  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = await window.owlDesktop.updateSettings(patch);
    setSettings(next);
    if (
      "runtimeBaseUrl" in patch ||
      "mcpEnabled" in patch ||
      "mcpPort" in patch ||
      "tunnelEnabled" in patch ||
      "tunnelBinaryPath" in patch ||
      "tunnelId" in patch ||
      "cloudEnabled" in patch ||
      "cloudBaseUrl" in patch ||
      "cloudDeviceId" in patch ||
      "cloudTelemetryEnabled" in patch
    ) {
      await refresh();
    }
    setNotice("Settings saved");
    window.setTimeout(() => setNotice(""), 1600);
  };

  const addSecret = async () => {
    if (!secretDraft.name.trim() || !secretDraft.value) return;
    await window.owlDesktop.upsertSecret(secretDraft);
    setSecrets(await window.owlDesktop.listSecrets());
    setSecretDraft({ name: "", project: "global", value: "" });
    setNotice("Secret encrypted and saved");
    window.setTimeout(() => setNotice(""), 1800);
  };

  const addAccount = async () => {
    if (!accountDraft.service.trim() || !accountDraft.label.trim()) return;
    await window.owlDesktop.upsertAccount({
      ...accountDraft,
      secret: accountDraft.secret || undefined,
    });
    setAccounts(await window.owlDesktop.listAccounts());
    setAccountDraft({
      service: "",
      label: "",
      identifier: "",
      authMethod: "password",
      secret: "",
    });
    setNotice("Account profile saved");
    window.setTimeout(() => setNotice(""), 1800);
  };

  const activityRows = useMemo(() => snapshot?.activity ?? [], [snapshot]);
  const logSources = useMemo(() => Array.from(new Set(activityRows.map((entry) => entry.source))).sort(), [activityRows]);
  const filteredActivityRows = useMemo(() => {
    const query = logQuery.trim().toLowerCase();
    return activityRows.filter((entry) => {
      if (logLevel === "warn" && entry.level !== "warn" && entry.level !== "error") return false;
      if (logLevel === "error" && entry.level !== "error") return false;
      if (logSource !== "all" && entry.source !== logSource) return false;
      if (!query) return true;
      const haystack = `${entry.source} ${entry.message} ${JSON.stringify(entry.meta ?? {})}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [activityRows, logLevel, logSource, logQuery]);
  const pendingAgentRequests = useMemo(
    () => agentRequests.filter((request) => request.status === "pending"),
    [agentRequests],
  );
  const claimedAgentRequests = useMemo(
    () => agentRequests.filter((request) => request.status === "claimed"),
    [agentRequests],
  );
  const runtimeEventStatus = snapshot?.runtimeEvents;
  const runtimeEventNeedsAttention =
    runtimeEventStatus?.status === "needs_attention";

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="traffic-spacer" />
      <div className="brand"><div className="brand-mark">O</div><div><strong>OWL LAB</strong><span>Desktop</span></div></div>
      <nav>{nav.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><Icon size={17} /><span>{item.label}</span>{item.id === "agent-inbox" && runtimeEventNeedsAttention ? <span className="nav-badge attention">!</span> : item.id === "agent-inbox" && pendingAgentRequests.length > 0 ? <span className="nav-badge">{pendingAgentRequests.length}</span> : null}</button>;
      })}</nav>
      <div className="sidebar-bottom">
        <div className="device-card"><div className="device-dot" /><div><strong>This Mac</strong><span>{env ? env.platform + " · " + env.arch : "Loading…"}</span></div></div>
        <div className="build-meta">OWL LAB Desktop {env?.appVersion ?? "0.1.0"}</div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="crumb">LOCAL CONTROL PLANE</div>
        <div className="top-actions">{notice && <span className="notice">{notice}</span>}<StatusPill online={online} /><button className="icon-button" onClick={refresh} disabled={busy} title="Refresh Runtime"><RefreshCw size={16} className={busy ? "spin" : ""} /></button></div>
      </header>

      <div className="content">
        {page === "overview" && <>
          <SectionHeader title="Good evening." description="Your local OWL LAB execution stack, sessions and operational health in one place." action={<button className="primary" onClick={refresh}><RefreshCw size={15} />Refresh Runtime</button>} />
          <section className={"hero-status " + (online ? "healthy" : "warning")}>
            <div className="hero-icon">{online ? <CheckCircle2 size={24} /> : <WifiOff size={24} />}</div>
            <div className="hero-copy"><span>LOCAL EXECUTION AUTHORITY</span><h2>{online ? "OWL Runtime is ready" : "OWL Runtime is not connected"}</h2><p>{online ? "Desktop is reading canonical execution state through RuntimeClient v" + apiVersion + "." : (snapshot?.error ?? "Start OWL Runtime or update the endpoint in Settings.")}</p></div>
            <div className="hero-side"><strong>{online ? snapshot?.latencyMs + " ms" : "—"}</strong><span>last probe</span></div>
          </section>
          <div className="metrics-grid">
            <MetricCard label="Persistent tasks" value={snapshot?.metrics.tasks ?? "—"} caption="Runtime-owned" icon={HardDrive} />
            <MetricCard label="Processes" value={snapshot?.metrics.processes ?? "—"} caption="Active + retained" icon={Cpu} />
            <MetricCard label="Approvals" value={snapshot?.metrics.approvals ?? "—"} caption="Runtime policy" icon={ShieldCheck} />
            <MetricCard label="Secrets" value={secrets.length} caption="OS-encrypted" icon={KeyRound} />
          </div>
          <div className="two-col">
            <section className="panel"><div className="panel-heading"><div><span className="eyebrow">COMPONENTS</span><h3>Platform status</h3></div></div>
              <div className="component-list">
                <div><span className="component-icon"><Boxes size={17} /></span><p><strong>OWL LAB Runtime</strong><small>{runtimeVersion}</small></p><StatusPill online={online} /></div>
                <div><span className="component-icon"><Terminal size={17} /></span><p><strong>OWL MCP</strong><small>{snapshot?.mcp.url ?? snapshot?.mcp.error ?? "Desktop adapter boundary"}</small></p><StatusPill online={snapshot?.mcp.status === "running"} /></div>
                <div><span className="component-icon"><Cloud size={17} /></span><p><strong>OWL LAB Cloud Bridge</strong><small>{snapshot?.cloud.deviceId ?? "Account/device connection"}</small></p>{cloudOnline ? <StatusPill online /> : <span className="neutral-pill">{cloudStatusLabel}</span>}</div>
                <div><span className="component-icon"><Inbox size={17} /></span><p><strong>Agent Inbox</strong><small>{runtimeEventNeedsAttention ? "Runtime event reconciliation required" : "Structured work waiting for an LLM/agent"}</small></p><span className={runtimeEventNeedsAttention ? "neutral-pill warning-pill" : "neutral-pill"}>{runtimeEventNeedsAttention ? "needs attention" : pendingAgentRequests.length + " pending"}</span></div>
              </div>
            </section>
            <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h3>Local events</h3></div><button className="text-button" onClick={() => setPage("logs")}>View logs</button></div>
              <div className="activity-list">{activityRows.slice(0, 5).map((entry) => <div key={entry.id}><span className={"log-dot " + entry.level} /><p><strong>{entry.message}</strong><small>{entry.source} · {formatTime(entry.at)}</small></p></div>)}{activityRows.length === 0 && <div className="empty">No local events yet.</div>}</div>
            </section>
          </div>
        </>}

        {page === "sessions" && <>
          <SectionHeader title="Sessions" description="Stable logical ownership identities used across Runtime reconnects." />
          <div className="session-card"><div className="session-title"><span className="avatar">D</span><div><strong>OWL LAB Desktop</strong><span>Primary local consumer session</span></div><StatusPill online={online} /></div>
            <div className="session-details"><div><span>Session ID</span><code>{settings?.sessionId ?? "—"}</code></div><div><span>Runtime API</span><strong>{apiVersion}</strong></div><div><span>Transport</span><strong>{snapshot?.info?.transport ?? "HTTP"}</strong></div><div><span>Last seen</span><strong>{formatTime(snapshot?.checkedAt)}</strong></div></div>
          </div>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">MCP TRANSPORT</span><h3>Connected transport sessions</h3></div><span className="neutral-pill">{snapshot?.mcp.sessionCount ?? 0} open</span></div>
            <div className="transport-list">{snapshot?.mcp.sessions.map((session) => <div key={session.transportSessionId}><span className={"log-dot " + (session.ownerStable ? "info" : "warn")} /><p><strong>{session.runtimeSessionId?.slice(0, 28) ?? "bootstrap"}…</strong><small>{session.ownerStable ? "stable logical owner" : "transport fallback"} · seen {formatTime(session.lastSeenAt)}</small></p><code>{session.transportSessionId.slice(0, 12)}…</code></div>)}{!snapshot?.mcp.sessions.length && <div className="empty">No active MCP transport sessions.</div>}</div>
          </section>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RUNTIME PROJECTION</span><h3>Processes visible to this consumer</h3></div></div><pre className="code-block">{pretty(snapshot?.processes)}</pre></section>
          <div className="contract-note"><ShieldCheck size={17} /><div><strong>Transport sessions are not Runtime session truth.</strong><p>Desktop can show its own MCP connections, but canonical cross-session execution inventory and event streaming remain CR-DESKTOP-001/002.</p></div></div>
        </>}

        {page === "agent-inbox" && <>
          <SectionHeader
            title="Agent Inbox"
            description="Structured reasoning work waiting for ChatGPT or another AI agent. Requests never override user intent or Runtime policy."
            action={<button className="secondary" onClick={refresh}><RefreshCw size={15} />Refresh</button>}
          />

          <section className={"panel runtime-event-feed " + (runtimeEventStatus?.status ?? "stopped")}>
            <div className="panel-heading">
              <div>
                <span className="eyebrow">RUNTIME DURABLE EVENT FEED</span>
                <h3>
                  {runtimeEventStatus?.status === "healthy"
                    ? "AgentRequest event replay is healthy"
                    : runtimeEventStatus?.status === "needs_attention"
                      ? "Reconciliation required"
                      : runtimeEventStatus?.status === "degraded"
                        ? "Event feed temporarily degraded"
                        : runtimeEventStatus?.status === "unsupported"
                          ? "Runtime event extension unavailable"
                          : "Event feed stopped"}
                </h3>
              </div>
              <span className={"neutral-pill event-feed-status " + (runtimeEventStatus?.status ?? "stopped")}>
                {(runtimeEventStatus?.status ?? "stopped").replaceAll("_", " ")}
              </span>
            </div>

            {runtimeEventNeedsAttention ? (
              <div className="runtime-event-reconciliation">
                <AlertTriangle size={20} />
                <div>
                  <strong>
                    {runtimeEventStatus?.reconciliation?.reasonCode ?? "RECONCILIATION_REQUIRED"}
                  </strong>
                  <p>
                    {runtimeEventStatus?.reconciliation?.message ??
                      "Desktop can no longer prove contiguous replay from its durable cursor."}
                  </p>
                  <div className="runtime-event-position">
                    <span>Saved cursor</span>
                    <code>{runtimeEventStatus?.reconciliation?.savedCursor ?? "none"}</code>
                    <span>Saved sequence</span>
                    <strong>{runtimeEventStatus?.reconciliation?.savedSequence ?? "—"}</strong>
                    <span>Oldest retained</span>
                    <strong>
                      {runtimeEventStatus?.reconciliation?.oldestRetainedSequence ??
                        runtimeEventStatus?.retention?.oldestSequence ??
                        "—"}
                    </strong>
                  </div>
                  <button
                    className="secondary"
                    onClick={async () => {
                      await window.owlDesktop.runtimeEventRetrySavedCursor();
                      await refresh();
                    }}
                  >
                    <RefreshCw size={14} />
                    Retry saved cursor
                  </button>
                  <small>
                    Desktop will not jump to Runtime's newest cursor. Replay stays blocked until the saved checkpoint can be reconciled.
                  </small>
                </div>
              </div>
            ) : (
              <div className="runtime-event-position">
                <span>Durable cursor</span>
                <code>{runtimeEventStatus?.consumer.lastCursor ?? "not established"}</code>
                <span>Sequence</span>
                <strong>{runtimeEventStatus?.consumer.lastSequence ?? "—"}</strong>
                <span>Runtime retained</span>
                <strong>
                  {runtimeEventStatus?.retention
                    ? `${runtimeEventStatus.retention.oldestSequence ?? "—"} → ${runtimeEventStatus.retention.newestSequence ?? "—"}`
                    : "—"}
                </strong>
                <span>Last success</span>
                <strong>{formatTime(runtimeEventStatus?.lastSuccessAt ?? undefined)}</strong>
              </div>
            )}

            {runtimeEventStatus?.status === "degraded" && (
              <div className="skill-warning">
                <AlertTriangle size={16} />
                <div>
                  <strong>{runtimeEventStatus.lastErrorCode ?? "EVENT_SYNC_DEGRADED"}</strong>
                  <p>{runtimeEventStatus.lastErrorMessage ?? "Desktop will retry without moving the durable cursor."}</p>
                </div>
              </div>
            )}

            {runtimeEventStatus?.status === "unsupported" && (
              <div className="contract-note compact-note">
                <ShieldCheck size={17} />
                <div>
                  <strong>Legacy Runtime compatibility mode.</strong>
                  <p>
                    This Runtime does not expose publicEventJournal v1 + agentRequestProducer v1. Desktop keeps the local Inbox but does not scrape diagnostics or Task files to invent events.
                  </p>
                </div>
              </div>
            )}
          </section>

          <div className="metrics-grid agent-inbox-metrics">
            <MetricCard label="Pending" value={pendingAgentRequests.length} caption="Available to agents" icon={Inbox} />
            <MetricCard label="Claimed" value={claimedAgentRequests.length} caption="Lease-owned" icon={Activity} />
            <MetricCard label="Completed" value={agentRequests.filter((request) => request.status === "completed").length} caption="Coordination resolved" icon={CheckCircle2} />
            <MetricCard label="Needs confirmation" value={agentRequests.filter((request) => request.status === "pending" && request.requiresUserConfirmation).length} caption="Consequential boundary" icon={ShieldCheck} />
          </div>

          <section className="panel agent-inbox-panel">
            <div className="panel-heading">
              <div><span className="eyebrow">LOCAL AGENT QUEUE</span><h3>Requests</h3></div>
              <span className="neutral-pill">{agentRequests.length} retained</span>
            </div>
            <div className="agent-request-list">
              {agentRequests.map((request) => (
                <article className={"agent-request " + request.status} key={request.requestId}>
                  <div className="agent-request-head">
                    <div>
                      <span className="eyebrow">{request.producer.toUpperCase()} · {request.status.toUpperCase()}</span>
                      <h3>{request.type}</h3>
                    </div>
                    <div className="agent-request-badges">
                      <span className={"agent-priority " + request.priority}>{request.priority}</span>
                      <span className="neutral-pill">{request.reasonCode}</span>
                    </div>
                  </div>
                  <div className="agent-request-subject">
                    <span>Subject</span>
                    <code>{request.subject.kind}:{request.subject.id}{request.subject.revision ? "@" + request.subject.revision : ""}</code>
                  </div>
                  {request.errorCodes.length > 0 && (
                    <div className="agent-chip-row">
                      {request.errorCodes.map((code) => <code key={code}>{code}</code>)}
                    </div>
                  )}
                  {request.allowedActions.length > 0 && (
                    <div className="agent-request-actions-view">
                      <span>Allowed coordination actions</span>
                      <div className="agent-chip-row">
                        {request.allowedActions.map((action) => <code key={action}>{action}</code>)}
                      </div>
                    </div>
                  )}
                  <div className="agent-request-foot">
                    <span>Created {formatTime(request.createdAt)}</span>
                    {request.claim && <span>Lease until {formatTime(request.claim.leaseExpiresAt)}</span>}
                    {request.resolution && <span>Outcome: {request.resolution.outcome}</span>}
                    {(request.status === "pending" || request.status === "claimed") && (
                      <button
                        className="text-button danger-text"
                        onClick={async () => {
                          await window.owlDesktop.cancelAgentRequest(request.requestId);
                          setAgentRequests(await window.owlDesktop.listAgentRequests({ limit: 100 }));
                        }}
                      >
                        Cancel request
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {agentRequests.length === 0 && (
                <div className="agent-inbox-empty">
                  <Inbox size={28} />
                  <strong>No AgentRequests</strong>
                  <span>OWL will place structured reasoning work here when a subsystem needs an LLM.</span>
                </div>
              )}
            </div>
          </section>

          <div className="contract-note">
            <ShieldCheck size={17} />
            <div>
              <strong>AgentRequest is not a prompt and not an approval.</strong>
              <p>It stores typed work references, reason/error codes and allowed coordination actions. ChatGPT claims work through MCP, then uses normal Runtime/Desktop tools to inspect and resolve it. Runtime remains the execution/validation authority.</p>
            </div>
          </div>
        </>}

        {page === "logs" && <>
          <SectionHeader title="Live Logs" description="Readable operational events across Desktop, Runtime, MCP and Cloud. Filter the signal first; raw diagnostics stay available below." action={<button className="secondary" onClick={refresh}><RefreshCw size={15} />Refresh</button>} />
          <section className="log-toolbar">
            <div className="log-filter-group" role="group" aria-label="Log severity">
              {(["all", "warn", "error"] as const).map((level) => <button key={level} className={logLevel === level ? "active" : ""} onClick={() => setLogLevel(level)}>{level === "all" ? "All" : level === "warn" ? "Warnings +" : "Errors"}</button>)}
            </div>
            <select value={logSource} onChange={(event) => setLogSource(event.target.value)} aria-label="Log source">
              <option value="all">All sources</option>
              {logSources.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
            <input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Search message or context…" aria-label="Search logs" />
            <span className="log-count">{filteredActivityRows.length} / {activityRows.length}</span>
          </section>
          <section className="readable-log-list">
            {filteredActivityRows.map((entry) => <article className={"readable-log-entry " + entry.level} key={entry.id}>
              <div className="readable-log-status"><span className={"log-dot " + entry.level} /><strong>{entry.level === "error" ? "Error" : entry.level === "warn" ? "Warning" : "Info"}</strong></div>
              <div className="readable-log-body">
                <div className="readable-log-heading"><strong>{entry.message}</strong><time>{formatTime(entry.at)}</time></div>
                <div className="readable-log-meta"><span>{entry.source}</span>{entry.meta && Object.keys(entry.meta).length > 0 && <details><summary>Context</summary><pre>{pretty(entry.meta)}</pre></details>}</div>
              </div>
            </article>)}
            {filteredActivityRows.length === 0 && <div className="empty log-empty">No events match these filters.</div>}
          </section>
          <section className="panel diagnostics-panel"><div className="panel-heading"><div><span className="eyebrow">RAW SUPPORT DATA</span><h3>Runtime diagnostics</h3></div><span className="neutral-pill">Support / debugging</span></div><p className="panel-help">This machine-readable projection is intentionally separated from the human event stream above.</p><pre className="code-block tall">{pretty(snapshot?.diagnostics)}</pre></section>
        </>}

        {page === "runtime" && <>
          <SectionHeader title="Runtime" description="Connection, compatibility and canonical execution state from OWL Runtime." action={<StatusPill online={online} />} />
          <div className="runtime-grid">
            <section className="panel runtime-summary"><span className="eyebrow">CONNECTION</span><h3>{settings?.runtimeBaseUrl ?? "—"}</h3><p>Stable session: <code>{sessionShort}</code></p><div className="runtime-version"><span>API {apiVersion}</span><span>Runtime {runtimeVersion}</span><span>{snapshot?.latencyMs ?? "—"} ms</span></div></section>
            <section className="panel"><span className="eyebrow">HEALTH</span><pre className="code-block compact">{pretty(snapshot?.health)}</pre></section>
          </div>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RUNTIME HOST</span><h3>Stable macOS permission identity</h3></div><StatusPill online={snapshot?.host?.host.installed === true} /></div>
            <div className="about-grid"><span>Bundle</span><strong>{snapshot?.host?.host.bundleIdentifier ?? "—"}</strong><span>Host version</span><strong>{snapshot?.host?.host.version ?? "—"}</strong><span>launchd</span><strong>{snapshot?.host?.service.state ?? "not loaded"}</strong><span>Role</span><strong>lifecycle consumer</strong></div>
            <div className="runtime-version"><button className="secondary" onClick={async () => { await window.owlDesktop.hostRestart(); await refresh(); }}>Restart service</button><button className="secondary" onClick={async () => { await window.owlDesktop.hostStop(); await refresh(); }}>Stop service</button></div>
          </section>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">OWL TUNNEL</span><h3>Remote transport to local MCP</h3></div><StatusPill online={snapshot?.tunnel.state === "running"} /></div>
            <div className="about-grid"><span>State</span><strong>{snapshot?.tunnel.state ?? "stopped"}</strong><span>PID</span><strong>{snapshot?.tunnel.pid ?? "—"}</strong><span>MCP target</span><code>{snapshot?.tunnel.mcpUrl ?? "—"}</code><span>Secret</span><strong>{snapshot?.tunnel.secretStorage ?? "OS encrypted"}</strong></div>
            <div className="runtime-version"><button className="secondary" onClick={async () => { await window.owlDesktop.tunnelStart(); await refresh(); }}>Start tunnel</button><button className="secondary" onClick={async () => { await window.owlDesktop.tunnelStop(); await refresh(); }}>Stop tunnel</button></div>
          </section>
          <section className="panel cloud-bridge-panel">
            <div className="panel-heading">
              <div><span className="eyebrow">OWL CLOUD BRIDGE</span><h3>Device control-plane transport</h3></div>
              {cloudOnline ? <StatusPill online /> : <span className="neutral-pill">{cloudStatusLabel}</span>}
            </div>
            <div className="about-grid">
              <span>Device</span><code>{snapshot?.cloud.deviceId ?? "Not enrolled"}</code>
              <span>Last heartbeat</span><strong>{formatTime(snapshot?.cloud.lastHeartbeatAt ?? undefined)}</strong>
              <span>Last command poll</span><strong>{formatTime(snapshot?.cloud.lastPollAt ?? undefined)}</strong>
              <span>Outbox</span><strong>{snapshot?.cloud.outboxPending ?? 0} pending</strong>
              <span>Accepted</span><strong>{snapshot?.cloud.commandCounts.accepted ?? 0}</strong>
              <span>Uncertain</span><strong>{snapshot?.cloud.commandCounts.uncertain ?? 0}</strong>
            </div>
            <div className="runtime-version cloud-actions">
              <button className="secondary" onClick={async () => { try { const result = await window.owlDesktop.cloudProbe(); setNotice(`Cloud ${result.contractVersion ?? "v1"} reachable`); } catch { setNotice("Cloud probe failed"); } window.setTimeout(() => setNotice(""), 1800); }}>Probe Cloud</button>
              <button className="secondary" onClick={async () => { await window.owlDesktop.cloudStart(); await refresh(); }}>Start bridge</button>
              <button className="secondary" onClick={async () => { await window.owlDesktop.cloudSync(); await refresh(); }}>Sync now</button>
              <button className="secondary" onClick={async () => { await window.owlDesktop.cloudStop(); await refresh(); }}>Stop bridge</button>
            </div>
            <div className="contract-note compact-note">
              <ShieldCheck size={17} />
              <div><strong>Cloud controls delivery; Runtime controls execution.</strong><p>Remote commands are deduplicated by commandId. Unknown command kinds are rejected. An uncertain Runtime completion is never replayed through another backend.</p></div>
            </div>
          </section>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">COMPATIBILITY</span><h3>Desktop consumer boundary</h3></div></div><div className="compat-row"><span>Minimum Runtime API</span><strong>0.1</strong><span>Preferred / tested</span><strong>0.1</strong><span>Fallback</span><strong>Fail closed</strong></div></section>
        </>}

        {page === "skills" && <SkillsPage />}

        {page === "accounts" && <>
          <SectionHeader title="Accounts" description="Identity & Session Vault for SaaS, social, websites and native apps. Credentials are encrypted locally; interactive factors stay human-in-the-loop." />
          <section className="panel secret-form account-form">
            <div><label>Service</label><input value={accountDraft.service} onChange={(e) => setAccountDraft({ ...accountDraft, service: e.target.value })} placeholder="WhatsApp / X / Shopify" /></div>
            <div><label>Account label</label><input value={accountDraft.label} onChange={(e) => setAccountDraft({ ...accountDraft, label: e.target.value })} placeholder="Main account" /></div>
            <div><label>Identifier</label><input value={accountDraft.identifier} onChange={(e) => setAccountDraft({ ...accountDraft, identifier: e.target.value })} placeholder="email / phone / @handle" /></div>
            <div><label>Auth method</label><select value={accountDraft.authMethod} onChange={(e) => setAccountDraft({ ...accountDraft, authMethod: e.target.value as AccountMeta["authMethod"] })}><option value="password">Password</option><option value="oauth">OAuth</option><option value="third_party_oauth">Third-party login</option><option value="qr">QR scan</option><option value="sms_otp">SMS OTP</option><option value="email_otp">Email OTP</option><option value="totp">Authenticator / TOTP</option><option value="authenticator_push">Authenticator push</option><option value="passkey">Passkey</option><option value="device_code">Device code</option><option value="native_app_session">Native app session</option></select></div>
            <div className="grow"><label>Stored secret (optional)</label><input type="password" value={accountDraft.secret} onChange={(e) => setAccountDraft({ ...accountDraft, secret: e.target.value })} placeholder="Only for credentials you explicitly choose to store" /></div>
            <button className="primary add-secret" onClick={addAccount}><Plus size={15} />Add</button>
          </section>
          <div className="contract-note"><ShieldCheck size={17} /><div><strong>OWL does not bypass MFA.</strong><p>QR, SMS/email codes, passkeys and authenticator approvals become explicit login challenges. Native app sessions and browser profiles are reused without extracting their credentials.</p></div></div>
          <section className="panel"><div className="secret-table head"><span>Account</span><span>Auth</span><span>Status</span><span /></div>{accounts.map((account) => <div className="secret-table" key={account.id}><div><UserRound size={15} /><p><strong>{account.service} · {account.label}</strong><small>{account.identifier || "No identifier"}</small></p></div><code>{account.authMethod}</code><span>{account.status}</span><button className="danger-icon" onClick={async () => { await window.owlDesktop.deleteAccount(account.id); setAccounts(await window.owlDesktop.listAccounts()); }}><Trash2 size={15} /></button></div>)}{accounts.length === 0 && <div className="empty table-empty">No managed accounts yet.</div>}</section>
        </>}

        {page === "secrets" && <>
          <SectionHeader title="Secrets" description="Project credentials are encrypted with the operating system key store; values are never returned to the renderer." />
          <section className="panel secret-form"><div><label>Secret name</label><input value={secretDraft.name} onChange={(e) => setSecretDraft({ ...secretDraft, name: e.target.value })} placeholder="OPENAI_API_KEY" /></div><div><label>Project / scope</label><input value={secretDraft.project} onChange={(e) => setSecretDraft({ ...secretDraft, project: e.target.value })} placeholder="global" /></div><div className="grow"><label>Value</label><input type="password" value={secretDraft.value} onChange={(e) => setSecretDraft({ ...secretDraft, value: e.target.value })} placeholder="••••••••••••" /></div><button className="primary add-secret" onClick={addSecret}><Plus size={15} />Save</button></section>
          <section className="panel"><div className="secret-table head"><span>Name</span><span>Scope</span><span>Updated</span><span /></div>{secrets.map((secret) => <div className="secret-table" key={secret.id}><div><KeyRound size={15} /><strong>{secret.name}</strong></div><code>{secret.project}</code><span>{new Date(secret.updatedAt).toLocaleDateString()}</span><button className="danger-icon" onClick={async () => { await window.owlDesktop.deleteSecret(secret.id); setSecrets(await window.owlDesktop.listSecrets()); }}><Trash2 size={15} /></button></div>)}{secrets.length === 0 && <div className="empty table-empty">No secrets stored yet.</div>}</section>
        </>}

        {page === "settings" && settings && <>
          <SectionHeader title="Settings" description="Local product preferences and Runtime connectivity." />
          <section className="panel settings-panel"><div className="setting-row"><div><strong>Runtime endpoint</strong><span>Loopback HTTP endpoint exposed by OWL Runtime.</span></div><input className="setting-input" value={settings.runtimeBaseUrl} onChange={(e) => setSettings({ ...settings, runtimeBaseUrl: e.target.value })} onBlur={() => saveSettings({ runtimeBaseUrl: settings.runtimeBaseUrl })} /></div>
            <div className="setting-row"><div><strong>Auto-connect Runtime</strong><span>Probe Runtime when OWL LAB Desktop starts.</span></div><Toggle checked={settings.autoConnectRuntime} onChange={(v) => saveSettings({ autoConnectRuntime: v })} /></div>
            <div className="setting-row"><div><strong>OWL MCP</strong><span>Run the ChatGPT/MCP compatibility adapter with the Desktop lifecycle.</span></div><Toggle checked={settings.mcpEnabled} onChange={(v) => saveSettings({ mcpEnabled: v })} /></div>
            <div className="setting-row"><div><strong>MCP port</strong><span>Loopback port used by OWL MCP and OWL Tunnel.</span></div><input className="setting-input" type="number" min="1024" max="65535" value={settings.mcpPort} onChange={(e) => setSettings({ ...settings, mcpPort: Number(e.target.value) })} onBlur={() => saveSettings({ mcpPort: settings.mcpPort })} /></div>
            <div className="setting-row"><div><strong>OWL Tunnel</strong><span>Run the remote transport to this Desktop's local MCP endpoint.</span></div><Toggle checked={settings.tunnelEnabled} onChange={(v) => saveSettings({ tunnelEnabled: v })} /></div>
            <div className="setting-row"><div><strong>Tunnel auto-start</strong><span>Start the tunnel after Desktop and MCP are ready.</span></div><Toggle checked={settings.tunnelAutoStart} onChange={(v) => saveSettings({ tunnelAutoStart: v })} /></div>
            <div className="setting-row"><div><strong>Tunnel binary</strong><span>Versioned OWL Tunnel client executable. Desktop owns lifecycle, not transport semantics.</span></div><input className="setting-input" value={settings.tunnelBinaryPath} onChange={(e) => setSettings({ ...settings, tunnelBinaryPath: e.target.value })} onBlur={() => saveSettings({ tunnelBinaryPath: settings.tunnelBinaryPath })} placeholder="/path/to/tunnel-client-runtime" /></div>
            <div className="setting-row"><div><strong>Tunnel ID</strong><span>Control-plane tunnel identity. API key belongs in Secrets as OWL_TUNNEL_API_KEY.</span></div><input className="setting-input" value={settings.tunnelId} onChange={(e) => setSettings({ ...settings, tunnelId: e.target.value })} onBlur={() => saveSettings({ tunnelId: settings.tunnelId })} placeholder="tunnel_…" /></div>
            <div className="setting-group-label"><Cloud size={14} /><span>Cloud Bridge</span></div>
            <div className="setting-row"><div><strong>OWL Cloud Bridge</strong><span>Connect this registered Desktop to OWL Cloud M1 control plane.</span></div><Toggle checked={settings.cloudEnabled} onChange={(v) => saveSettings({ cloudEnabled: v })} /></div>
            <div className="setting-row"><div><strong>Cloud auto-start</strong><span>Start heartbeat, command pull and projection outbox after Desktop launches.</span></div><Toggle checked={settings.cloudAutoStart} onChange={(v) => saveSettings({ cloudAutoStart: v })} /></div>
            <div className="setting-row"><div><strong>Cloud API endpoint</strong><span>OWL Cloud HTTP API v1. Device transport uses the separately stored device credential.</span></div><input className="setting-input" value={settings.cloudBaseUrl} onChange={(e) => setSettings({ ...settings, cloudBaseUrl: e.target.value })} onBlur={() => saveSettings({ cloudBaseUrl: settings.cloudBaseUrl })} placeholder="https://…execute-api…amazonaws.com" /></div>
            <div className="setting-row"><div><strong>Cloud device ID</strong><span>Canonical deviceId returned by Cloud registration.</span></div><input className="setting-input" value={settings.cloudDeviceId} onChange={(e) => setSettings({ ...settings, cloudDeviceId: e.target.value })} onBlur={() => saveSettings({ cloudDeviceId: settings.cloudDeviceId })} placeholder="dev_…" /></div>
            <div className="setting-row"><div><strong>Provider telemetry</strong><span>Send privacy-bounded operational metadata only. No command payload, credentials or user content.</span></div><Toggle checked={settings.cloudTelemetryEnabled} onChange={(v) => saveSettings({ cloudTelemetryEnabled: v })} /></div>
            <div className="contract-note compact-note"><KeyRound size={17} /><div><strong>Device credential stays OS-encrypted.</strong><p>Store it in Secrets as <code>OWL_CLOUD_DEVICE_CREDENTIAL</code> with scope <code>owl-cloud</code>. Human Cognito login/device enrollment is a separate product flow.</p></div></div>
            <div className="setting-row"><div><strong>Runtime diagnostics</strong><span>Include Runtime support projections in the Logs screen.</span></div><Toggle checked={settings.diagnosticsEnabled} onChange={(v) => saveSettings({ diagnosticsEnabled: v })} /></div>
            <div className="setting-row"><div><strong>Launch at login</strong><span>Start OWL Desktop after macOS login in packaged builds.</span></div><Toggle checked={settings.launchAtLogin} onChange={(v) => saveSettings({ launchAtLogin: v })} /></div>
          </section>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">ABOUT</span><h3>Local installation</h3></div></div><div className="about-grid"><span>Desktop</span><strong>{env?.appVersion}</strong><span>Electron</span><strong>{env?.electronVersion}</strong><span>Platform</span><strong>{env?.platform} / {env?.arch}</strong><span>Session</span><code>{sessionShort}</code></div></section>
        </>}
      </div>
    </main>
  </div>;
}
