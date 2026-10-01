import { useEffect, useMemo, useState } from "react";
import {
  Activity, Boxes, CheckCircle2, Cloud, Cpu, Gauge, HardDrive,
  KeyRound, ListTree, Plus, RefreshCw, Settings2, ShieldCheck,
  Terminal, Trash2, Wifi, WifiOff, UserRound, Link2, Puzzle, Inbox,
  AlertTriangle, ArrowRight, BrainCircuit, Clock3, FolderOpen, X,
  ChartNoAxesCombined, Laptop,
} from "lucide-react";
import type { AccountMeta, ActivityEntry, AgentRequest, CloudAccountStatus, DesktopEnvironment, RuntimeSnapshot, SecretMeta, Settings } from "./types";
import { SkillsPage } from "./skills/SkillsPage";
import { deriveWorkState } from "./workState";
import { MonitorPage } from "./monitor/MonitorPage";
import { DevicesPage } from "./devices/DevicesPage";

type Page = "overview" | "monitor" | "devices" | "sessions" | "agent-inbox" | "logs" | "runtime" | "skills" | "accounts" | "secrets" | "settings";

const nav = [
  { id: "overview" as Page, label: "Home", icon: Gauge },
  { id: "monitor" as Page, label: "Monitor", icon: ChartNoAxesCombined },
  { id: "devices" as Page, label: "Devices", icon: Laptop },
  { id: "agent-inbox" as Page, label: "Requests", icon: Inbox },
  { id: "logs" as Page, label: "Activity", icon: Activity },
  { id: "skills" as Page, label: "Skills", icon: Puzzle },
  { id: "accounts" as Page, label: "Accounts", icon: UserRound },
  { id: "settings" as Page, label: "Settings", icon: Settings2 },
];

const advancedNav = [
  { id: "sessions" as Page, label: "Sessions", icon: ListTree },
  { id: "runtime" as Page, label: "Runtime", icon: Boxes },
  { id: "secrets" as Page, label: "Secrets", icon: KeyRound },
];

const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
const formatTime = (value?: string) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const formatLogSource = (value: string) => ({
  desktop: "OWL Desktop",
  runtime: "OWL Runtime",
  "runtime-events": "Runtime Events",
  mcp: "OWL MCP",
  cloud: "Cloud Bridge",
  tunnel: "OWL Tunnel",
}[value] ?? value.replaceAll("-", " ").replace(/\b\w/g, (char) => char.toUpperCase()));

const collectionRows = (
  value: unknown,
  keys: string[],
): Array<Record<string, any>> => {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, any> =>
      Boolean(item && typeof item === "object"),
    );
  }
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(object[key])) {
      return (object[key] as unknown[]).filter(
        (item): item is Record<string, any> =>
          Boolean(item && typeof item === "object"),
      );
    }
  }
  return collectionRows(object.result, keys);
};

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
  const [cloudAccount, setCloudAccount] = useState<CloudAccountStatus | null>(null);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [accounts, setAccounts] = useState<AccountMeta[]>([]);
  const [agentRequests, setAgentRequests] = useState<AgentRequest[]>([]);
  const [liveActivity, setLiveActivity] = useState<ActivityEntry[]>([]);
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
  const [now, setNow] = useState(() => Date.now());

  const online = snapshot?.mode === "live";
  const runtimeAccess = snapshot?.runtimeAccess ?? cloudAccount?.runtimeAccess ?? null;
  const executionReady =
    online &&
    (runtimeAccess?.mode === "compat" || runtimeAccess?.state === "READY");
  const cloudOnline = snapshot?.cloud.status === "connected";
  const cloudStatusLabel = snapshot?.cloud.status
    ? snapshot.cloud.status.replaceAll("_", " ")
    : "stopped";

  const productReadiness = useMemo(() => {
    if (!online) {
      return {
        state: "LOCAL_RECOVERY",
        label: "Runtime recovery",
        title: "Local Runtime needs attention",
        description: snapshot?.error ?? "OWL Runtime is not reachable.",
      };
    }
    if (cloudAccount?.status !== "ready") {
      return {
        state: "SETUP_REQUIRED",
        label: "Setup required",
        title: "Sign in to finish setup",
        description: "Your local Runtime is reachable, but OWL LAB account setup is not complete.",
      };
    }
    if (!executionReady) {
      return {
        state: "AUTHORIZATION_REQUIRED",
        label: "Authorization required",
        title: "Execution access needs renewal",
        description: "Read-only Runtime status is available, but new work needs a valid execution lease.",
      };
    }
    if (snapshot?.mcp.status !== "running" || snapshot?.tunnel.state !== "running") {
      return {
        state: "CHATGPT_CONNECTION_REQUIRED",
        label: "Connect ChatGPT",
        title: "Local execution is ready",
        description: "Start or recover the OWL MCP/Tunnel connection so ChatGPT can reach this Mac.",
      };
    }
    return {
      state: "READY",
      label: "Ready",
      title: "OWL LAB is ready",
      description: "Account, local execution authority and ChatGPT transport are ready.",
    };
  }, [
    online,
    snapshot?.error,
    snapshot?.mcp.status,
    snapshot?.tunnel.state,
    cloudAccount?.status,
    executionReady,
  ]);

  const readinessReady = productReadiness.state === "READY";

  const refresh = async (interactive = true) => {
    if (interactive) setBusy(true);
    try {
      await window.owlDesktop.runtimeEventSync().catch(() => undefined);
      const [nextSnapshot, nextAgentRequests] = await Promise.all([
        window.owlDesktop.refreshRuntime({ quiet: !interactive }),
        window.owlDesktop.listAgentRequests({ limit: 100 }),
      ]);
      setSnapshot(nextSnapshot);
      setLiveActivity(nextSnapshot.activity ?? []);
      setAgentRequests(nextAgentRequests);
      setNow(Date.now());
    } finally {
      if (interactive) setBusy(false);
    }
  };

  useEffect(() => {
    Promise.all([
      window.owlDesktop.environment(),
      window.owlDesktop.getSettings(),
      window.owlDesktop.listSecrets(),
      window.owlDesktop.listAccounts(),
      window.owlDesktop.listAgentRequests({ limit: 100 }),
      window.owlDesktop.cloudAccountStatus(),
    ]).then(([nextEnv, nextSettings, nextSecrets, nextAccounts, nextAgentRequests, nextCloudAccount]) => {
      setEnv(nextEnv);
      setSettings(nextSettings);
      setSecrets(nextSecrets);
      setAccounts(nextAccounts);
      setAgentRequests(nextAgentRequests);
      setCloudAccount(nextCloudAccount);
      if (nextSettings.autoConnectRuntime) void refresh(false);
    });
    const unsubscribe = window.owlDesktop.onCloudAccountUpdated((value) => {
      setCloudAccount(value);
      void refresh(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (page !== "overview" && page !== "monitor") return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh(false);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [page]);

  const runtimeVersion = snapshot?.info?.runtimeVersion ?? "Not connected";
  const apiVersion = snapshot?.info?.apiVersion ?? "—";
  const sessionShort = settings?.sessionId ? settings.sessionId.slice(0, 22) + "…" : "—";

  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = await window.owlDesktop.updateSettings(patch);
    setSettings(next);
    if (
      "wakeName" in patch ||
      "wakeAliases" in patch ||
      "allowedDirectories" in patch ||
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
    const runtimePreferenceChanged =
      "wakeName" in patch ||
      "wakeAliases" in patch ||
      "allowedDirectories" in patch;
    setNotice(
      runtimePreferenceChanged && env?.isPackaged === false
        ? "Saved · restart dev:full to apply Runtime preferences"
        : "Settings saved",
    );
    window.setTimeout(() => setNotice(""), 2400);
  };

  const addAllowedFolders = async () => {
    if (!settings) return;
    const picked = await window.owlDesktop.pickAllowedFolders();
    if (picked.length === 0) return;
    await saveSettings({
      allowedDirectories: [
        ...new Set([...settings.allowedDirectories, ...picked]),
      ],
    });
  };

  const removeAllowedFolder = async (folder: string) => {
    if (!settings) return;
    await saveSettings({
      allowedDirectories: settings.allowedDirectories.filter(
        (value) => value !== folder,
      ),
    });
  };

  const readinessActionLabel =
    productReadiness.state === "LOCAL_RECOVERY"
      ? "Repair Runtime"
      : productReadiness.state === "SETUP_REQUIRED"
        ? "Sign in"
        : productReadiness.state === "AUTHORIZATION_REQUIRED"
          ? "Reauthorize"
          : productReadiness.state === "CHATGPT_CONNECTION_REQUIRED"
            ? "Connect ChatGPT"
            : "Refresh";

  const runReadinessAction = async () => {
    setBusy(true);
    try {
      if (productReadiness.state === "LOCAL_RECOVERY") {
        await window.owlDesktop.hostRestart();
      } else if (productReadiness.state === "SETUP_REQUIRED") {
        await window.owlDesktop.cloudLogin();
        setNotice("Continue sign-in in your browser");
        window.setTimeout(() => setNotice(""), 2400);
        return;
      } else if (productReadiness.state === "AUTHORIZATION_REQUIRED") {
        const result = await window.owlDesktop.cloudReauthorize();
        setCloudAccount(await window.owlDesktop.cloudAccountStatus());
        if (result.interactionRequired) {
          setNotice("Continue sign-in in your browser");
          window.setTimeout(() => setNotice(""), 2400);
          return;
        }
      } else if (productReadiness.state === "CHATGPT_CONNECTION_REQUIRED") {
        if (snapshot?.mcp.status !== "running") {
          await saveSettings({ mcpEnabled: true });
        }
        if (settings?.tunnelEnabled !== true) {
          await saveSettings({ tunnelEnabled: true });
        }
        await window.owlDesktop.tunnelStart();
      }
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Recovery action failed",
      );
      window.setTimeout(() => setNotice(""), 2400);
    } finally {
      setBusy(false);
    }
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

  useEffect(() => {
    if (page !== "logs") return;
    let cancelled = false;
    const pollActivity = async () => {
      const rows = await window.owlDesktop.listActivity().catch(() => null);
      if (!cancelled && rows) setLiveActivity(rows);
    };
    void pollActivity();
    const timer = window.setInterval(() => void pollActivity(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [page]);

  const activityRows = useMemo(() => liveActivity.length > 0 ? liveActivity : (snapshot?.activity ?? []), [liveActivity, snapshot]);
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

  const taskRows = useMemo(
    () => collectionRows(snapshot?.tasks, ["tasks", "items"]),
    [snapshot?.tasks],
  );
  const processRows = useMemo(
    () => collectionRows(snapshot?.processes, ["processes", "items"]),
    [snapshot?.processes],
  );
  const runningProcesses = useMemo(
    () => processRows.filter((process) => process.running === true),
    [processRows],
  );

  const workState = useMemo(() => deriveWorkState({
    taskRows,
    runningProcesses,
    readinessReady,
    productReadiness,
    runtimeEventNeedsAttention,
    runtimeEventStatus,
    claimedAgentRequests,
    pendingAgentRequests,
    plannerContinuation: snapshot?.mcp.continuation,
    wakeName: settings?.wakeName,
    checkedAt: snapshot?.checkedAt,
    now,
  }), [
    taskRows,
    runningProcesses,
    now,
    readinessReady,
    productReadiness,
    runtimeEventNeedsAttention,
    runtimeEventStatus,
    claimedAgentRequests,
    pendingAgentRequests,
    snapshot?.mcp.continuation,
    settings?.wakeName,
    snapshot?.checkedAt,
  ]);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="traffic-spacer" />
      <div className="brand"><div className="brand-mark">O</div><div><strong>OWL LAB</strong><span>Desktop</span></div></div>
      <nav>{nav.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><Icon size={17} /><span>{item.label}</span>{item.id === "agent-inbox" && runtimeEventNeedsAttention ? <span className="nav-badge attention">!</span> : item.id === "agent-inbox" && pendingAgentRequests.length > 0 ? <span className="nav-badge">{pendingAgentRequests.length}</span> : null}</button>;
      })}
        <details className="nav-advanced" open={advancedNav.some((item) => item.id === page)}>
          <summary><span>Advanced</span><span>•••</span></summary>
          <div>{advancedNav.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><Icon size={16} /><span>{item.label}</span></button>;
          })}</div>
        </details>
      </nav>
      <div className="sidebar-bottom">
        <div className="device-card"><div className="device-dot" /><div><strong>This Mac</strong><span>{env ? env.platform + " · " + env.arch : "Loading…"}</span></div></div>
        <div className="build-meta">OWL LAB Desktop {env?.appVersion ?? "0.1.0"}</div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="crumb">OWL LAB · THIS MAC</div>
        <div className="top-actions">{notice && <span className="notice">{notice}</span>}<span className={"readiness-pill " + (readinessReady ? "ready" : "attention")}>{readinessReady ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{productReadiness.label}</span><button className="icon-button" onClick={() => void refresh()} disabled={busy} title="Refresh OWL LAB status"><RefreshCw size={16} className={busy ? "spin" : ""} /></button></div>
      </header>

      <div className="content">
        {page === "overview" && <>
          <SectionHeader title="Your OWL" description="See what OWL is doing, whether it is waiting, and what needs your attention." action={<button className="primary" onClick={runReadinessAction} disabled={busy}>{productReadiness.state === "READY" ? <RefreshCw size={15} /> : <ArrowRight size={15} />}{readinessActionLabel}</button>} />
          <section className={"hero-status " + (readinessReady ? "healthy" : "warning")}>
            <div className="hero-icon">{readinessReady ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}</div>
            <div className="hero-copy"><span>PRODUCT READINESS</span><h2>{productReadiness.title}</h2><p>{productReadiness.description}</p></div>
            <div className="hero-side"><strong>{online ? snapshot?.latencyMs + " ms" : "—"}</strong><span>Runtime probe</span></div>
          </section>

          <section className={"work-status-card " + workState.state}>
            <div className="work-status-icon">
              {workState.state === "working" ? <BrainCircuit size={24} /> :
               workState.state === "idle" ? <CheckCircle2 size={24} /> :
               workState.state === "waiting" ? <Clock3 size={24} /> :
               <AlertTriangle size={24} />}
            </div>
            <div className="work-status-main">
              <div className="work-status-heading">
                <span className="eyebrow">WHAT OWL IS DOING</span>
                <span className={"work-state-pill " + workState.state}>{workState.label}</span>
              </div>
              <h2>{workState.title}</h2>
              <p>{workState.detail}</p>
              {workState.progress !== null && <div className="work-progress"><span style={{ width: `${workState.progress}%` }} /></div>}
              <div className="work-status-meta">
                <span>{workState.signal}</span>
                <span>{runningProcesses.length} running process{runningProcesses.length === 1 ? "" : "es"}</span>
                <span>{workState.lastChangedAt ? "Updated " + formatTime(workState.lastChangedAt) : "Waiting for first update"}</span>
              </div>
            </div>
            <div className="work-status-actions">
              <button className="secondary" onClick={() => setPage("runtime")}>View work</button>
              <button className="text-button" onClick={() => setPage("logs")}>View logs</button>
            </div>
          </section>

          <div className="metrics-grid">
            <MetricCard label="Tasks" value={snapshot?.metrics.tasks ?? "—"} caption="Recent & persistent" icon={HardDrive} />
            <MetricCard label="Background work" value={runningProcesses.length} caption="Running now" icon={Cpu} />
            <MetricCard label="Approvals" value={snapshot?.metrics.approvals ?? "—"} caption="May need you" icon={ShieldCheck} />
            <MetricCard label="Connected secrets" value={secrets.length} caption="Encrypted locally" icon={KeyRound} />
          </div>
          <div className="two-col">
            <section className="panel"><div className="panel-heading"><div><span className="eyebrow">SYSTEM HEALTH</span><h3>Connections</h3></div></div>
              <div className="component-list">
                <div><span className="component-icon"><Boxes size={17} /></span><p><strong>Local engine</strong><small>{runtimeVersion}</small></p><StatusPill online={online} /></div>
                <div><span className="component-icon"><Terminal size={17} /></span><p><strong>ChatGPT connection</strong><small>{snapshot?.mcp.status === "running" ? "ChatGPT can reach this Mac" : snapshot?.mcp.error ?? "Not connected"}</small></p><StatusPill online={snapshot?.mcp.status === "running"} /></div>
                <div><span className="component-icon"><Cloud size={17} /></span><p><strong>OWL LAB account</strong><small>{cloudOnline ? "Cloud account & device connected" : "Cloud connection unavailable"}</small></p>{cloudOnline ? <StatusPill online /> : <span className="neutral-pill">{cloudStatusLabel}</span>}</div>
                <div><span className="component-icon"><Inbox size={17} /></span><p><strong>Requests</strong><small>{runtimeEventNeedsAttention ? "History needs attention before replay" : "Work waiting for an AI agent"}</small></p><span className={runtimeEventNeedsAttention ? "neutral-pill warning-pill" : "neutral-pill"}>{runtimeEventNeedsAttention ? "needs attention" : pendingAgentRequests.length + " pending"}</span></div>
              </div>
            </section>
            <section className="panel"><div className="panel-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h3>Local events</h3></div><button className="text-button" onClick={() => setPage("logs")}>View logs</button></div>
              <div className="activity-list">{activityRows.slice(0, 5).map((entry) => <div key={entry.id}><span className={"log-dot " + entry.level} /><p><strong>{entry.message}</strong><small>{entry.source} · {formatTime(entry.at)}</small></p></div>)}{activityRows.length === 0 && <div className="empty">No local events yet.</div>}</div>
            </section>
          </div>
        </>}

        {page === "monitor" && <MonitorPage
          snapshot={snapshot}
          agentRequests={agentRequests}
          activity={activityRows}
          onRefresh={() => refresh(false)}
        />}

        {page === "devices" && <DevicesPage
          accountReady={cloudAccount?.status === "ready"}
          currentDeviceId={cloudAccount?.deviceId ?? snapshot?.cloud.deviceId ?? null}
        />}

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
            action={<button className="secondary" onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button>}
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
          <SectionHeader title="Live Logs" description="Readable operational events across Desktop, Runtime, MCP and Cloud. Filter the signal first; raw diagnostics stay available below." action={<button className="secondary" onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button>} />
          <section className="log-toolbar">
            <div className="log-filter-group" role="group" aria-label="Log severity">
              {(["all", "warn", "error"] as const).map((level) => <button key={level} className={logLevel === level ? "active" : ""} onClick={() => setLogLevel(level)}>{level === "all" ? "All" : level === "warn" ? "Warnings +" : "Errors"}</button>)}
            </div>
            <select value={logSource} onChange={(event) => setLogSource(event.target.value)} aria-label="Log source">
              <option value="all">All sources</option>
              {logSources.map((source) => <option key={source} value={source}>{formatLogSource(source)}</option>)}
            </select>
            <input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Search message or context…" aria-label="Search logs" />
            <span className="log-count">Live · 1s · {filteredActivityRows.length} / {activityRows.length}</span>
          </section>
          <section className="readable-log-list">
            {filteredActivityRows.map((entry) => <article className={"readable-log-entry " + entry.level} key={entry.id}>
              <div className="readable-log-status"><span className={"log-dot " + entry.level} /><strong>{entry.level === "error" ? "Error" : entry.level === "warn" ? "Warning" : "Info"}</strong></div>
              <div className="readable-log-body">
                <div className="readable-log-heading"><strong>{entry.message}</strong><time>{formatTime(entry.at)}</time></div>
                <div className="readable-log-meta"><span>{formatLogSource(entry.source)}</span>{entry.meta && Object.keys(entry.meta).length > 0 && <details><summary>Context</summary><pre>{pretty(entry.meta)}</pre></details>}</div>
              </div>
            </article>)}
            {filteredActivityRows.length === 0 && <div className="empty log-empty">No events match these filters.</div>}
          </section>
          <section className="panel diagnostics-panel"><div className="panel-heading"><div><span className="eyebrow">RAW SUPPORT DATA</span><h3>Runtime diagnostics</h3></div><span className="neutral-pill">Support / debugging</span></div><p className="panel-help">This machine-readable projection is intentionally separated from the human event stream above.</p><pre className="code-block tall">{pretty(snapshot?.diagnostics)}</pre></section>
        </>}

        {page === "runtime" && <>
          <SectionHeader title="Runtime" description="Connection, compatibility and canonical execution state from OWL Runtime." action={<StatusPill online={online} />} />
          <div className="runtime-grid">
            <section className="panel runtime-summary"><span className="eyebrow">CONNECTION</span><h3>{snapshot?.runtimeEndpoint ?? settings?.runtimeBaseUrl ?? "—"}</h3><p>Stable session: <code>{sessionShort}</code></p><div className="runtime-version"><span>API {apiVersion}</span><span>Runtime {runtimeVersion}</span><span>{snapshot?.latencyMs ?? "—"} ms</span>{snapshot?.runtimeEndpoint && snapshot.runtimeEndpoint !== settings?.runtimeBaseUrl ? <span>DEV override</span> : null}</div></section>
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
              <div><span className="eyebrow">OWL LAB ACCOUNT</span><h3>Account, device enrollment & control plane</h3></div>
              <span className="neutral-pill">{cloudAccount?.status?.replaceAll("_", " ") ?? "signed out"}</span>
            </div>
            <div className="about-grid">
              <span>Account</span><strong>{cloudAccount?.status === "ready" ? "Authenticated" : cloudAccount?.status?.replaceAll("_", " ") ?? "Signed out"}</strong>
              <span>Cloud run access</span><strong>{cloudAccount?.access?.canRun === true ? "Granted" : "Not granted"}</strong>
              <span>Runtime access</span><strong>{runtimeAccess?.state ?? "Unknown"}{runtimeAccess?.mode ? ` · ${runtimeAccess.mode}` : ""}</strong>
              <span>Lease expires</span><strong>{runtimeAccess?.grant?.expiresAt ? new Date(runtimeAccess.grant.expiresAt).toLocaleString() : "—"}</strong>
              <span>Device</span><code>{cloudAccount?.deviceId ?? snapshot?.cloud.deviceId ?? "Not enrolled"}</code>
              <span>Bridge</span><strong>{cloudOnline ? "Connected" : cloudStatusLabel}</strong>
              <span>Last heartbeat</span><strong>{formatTime(snapshot?.cloud.lastHeartbeatAt ?? undefined)}</strong>
              <span>Last command poll</span><strong>{formatTime(snapshot?.cloud.lastPollAt ?? undefined)}</strong>
              <span>Outbox</span><strong>{snapshot?.cloud.outboxPending ?? 0} pending</strong>
              <span>Accepted</span><strong>{snapshot?.cloud.commandCounts.accepted ?? 0}</strong>
              <span>Uncertain</span><strong>{snapshot?.cloud.commandCounts.uncertain ?? 0}</strong>
            </div>
            <div className="runtime-version cloud-actions">
              {cloudAccount?.status === "ready" ? <button className="secondary" onClick={async () => { const next = await window.owlDesktop.cloudLogout(); setCloudAccount(next); }}>Sign out</button> : <button className="primary" disabled={!settings?.cloudBaseUrl?.trim() || cloudAccount?.status === "authorizing"} onClick={async () => { try { await window.owlDesktop.cloudLogin(); setCloudAccount(await window.owlDesktop.cloudAccountStatus()); setNotice("Continue sign-in in your browser"); } catch (error) { setNotice(error instanceof Error ? error.message : "Cloud login failed"); } window.setTimeout(() => setNotice(""), 2400); }}>{cloudAccount?.status === "authorizing" ? "Waiting for browser…" : "Sign in to OWL LAB"}</button>}
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
          <SectionHeader title="Settings" description="Everyday preferences first. Technical connection details stay out of the way." />

          <section className="panel settings-panel everyday-settings">
            <div className="panel-heading">
              <div><span className="eyebrow">PERSONALISE OWL</span><h3>Name & invocation</h3></div>
              <span className="neutral-pill">Everyday</span>
            </div>
            <div className="setting-row">
              <div>
                <strong>Wake name</strong>
                <span>The name ChatGPT and other agents use to invoke your local OWL Runtime. Example: OWL or Jarvis.</span>
              </div>
              <input
                className="setting-input compact-input"
                value={settings.wakeName}
                onChange={(e) => setSettings({ ...settings, wakeName: e.target.value })}
                onBlur={() => saveSettings({ wakeName: settings.wakeName })}
                maxLength={64}
                placeholder="OWL"
              />
            </div>
            <div className="setting-row">
              <div>
                <strong>Aliases</strong>
                <span>Optional alternative names, separated by commas.</span>
              </div>
              <input
                className="setting-input"
                value={settings.wakeAliases.join(", ")}
                onChange={(e) => setSettings({
                  ...settings,
                  wakeAliases: e.target.value.split(",").map((value) => value.trim()),
                })}
                onBlur={() => saveSettings({
                  wakeAliases: settings.wakeAliases
                    .map((value) => value.trim())
                    .filter(Boolean),
                })}
                placeholder="OWL Runtime, AgentOS"
              />
            </div>
          </section>

          <section className="panel settings-panel folder-settings">
            <div className="panel-heading">
              <div><span className="eyebrow">FILES & FOLDERS</span><h3>Folders OWL can access</h3></div>
              <button className="secondary" onClick={addAllowedFolders}><FolderOpen size={15} />Add folder</button>
            </div>
            <p className="panel-help">OWL can only read or write normal files inside these folders. OWL LAB's own internal product data is managed separately and does not need to be added here.</p>
            <div className="allowed-folder-list">
              {settings.allowedDirectories.map((folder) => <div className="allowed-folder-row" key={folder}>
                <span className="folder-icon"><FolderOpen size={16} /></span>
                <code>{folder}</code>
                <button className="danger-icon" title="Remove folder" onClick={() => void removeAllowedFolder(folder)}><X size={15} /></button>
              </div>)}
              {settings.allowedDirectories.length === 0 && <div className="empty folder-empty">No folders are allowed. OWL cannot access your normal files until you add one.</div>}
            </div>
          </section>

          <section className="panel settings-panel">
            <div className="panel-heading"><div><span className="eyebrow">BEHAVIOUR</span><h3>Desktop preferences</h3></div></div>
            <div className="setting-row"><div><strong>Launch at login</strong><span>Start OWL LAB Desktop automatically after macOS login.</span></div><Toggle checked={settings.launchAtLogin} onChange={(v) => saveSettings({ launchAtLogin: v })} /></div>
            <div className="setting-row"><div><strong>Operational telemetry</strong><span>Share privacy-bounded health metadata. Never command payloads, credentials, or user content.</span></div><Toggle checked={settings.cloudTelemetryEnabled} onChange={(v) => saveSettings({ cloudTelemetryEnabled: v })} /></div>
            <div className="setting-row"><div><strong>Diagnostics</strong><span>Keep redacted Runtime diagnostics available when something goes wrong.</span></div><Toggle checked={settings.diagnosticsEnabled} onChange={(v) => saveSettings({ diagnosticsEnabled: v })} /></div>
          </section>

          <details className="panel settings-panel advanced-settings">
            <summary>
              <div><span className="eyebrow">ADVANCED</span><strong>Connection & transport internals</strong><small>Runtime, MCP, Tunnel and Cloud implementation settings</small></div>
              <span className="neutral-pill">Technical</span>
            </summary>
            <div className="setting-row"><div><strong>Runtime endpoint</strong><span>Loopback HTTP endpoint exposed by OWL Runtime.</span></div><input className="setting-input" value={settings.runtimeBaseUrl} onChange={(e) => setSettings({ ...settings, runtimeBaseUrl: e.target.value })} onBlur={() => saveSettings({ runtimeBaseUrl: settings.runtimeBaseUrl })} /></div>
            <div className="setting-row"><div><strong>Auto-connect Runtime</strong><span>Probe Runtime when OWL LAB Desktop starts.</span></div><Toggle checked={settings.autoConnectRuntime} onChange={(v) => saveSettings({ autoConnectRuntime: v })} /></div>
            <div className="setting-row"><div><strong>OWL MCP</strong><span>Run the ChatGPT/MCP compatibility adapter with the Desktop lifecycle.</span></div><Toggle checked={settings.mcpEnabled} onChange={(v) => saveSettings({ mcpEnabled: v })} /></div>
            <div className="setting-row"><div><strong>MCP port</strong><span>Loopback port used by OWL MCP and OWL Tunnel.</span></div><input className="setting-input" type="number" min="1024" max="65535" value={settings.mcpPort} onChange={(e) => setSettings({ ...settings, mcpPort: Number(e.target.value) })} onBlur={() => saveSettings({ mcpPort: settings.mcpPort })} /></div>
            <div className="setting-row"><div><strong>OWL Tunnel</strong><span>Run the remote transport to this Desktop's local MCP endpoint.</span></div><Toggle checked={settings.tunnelEnabled} onChange={(v) => saveSettings({ tunnelEnabled: v })} /></div>
            <div className="setting-row"><div><strong>Tunnel auto-start</strong><span>Start the tunnel after Desktop and MCP are ready.</span></div><Toggle checked={settings.tunnelAutoStart} onChange={(v) => saveSettings({ tunnelAutoStart: v })} /></div>
            <div className="setting-row"><div><strong>Tunnel binary override</strong><span>Leave empty to use the vendored OWL Tunnel for this architecture.</span></div><input className="setting-input" value={settings.tunnelBinaryPath} onChange={(e) => setSettings({ ...settings, tunnelBinaryPath: e.target.value })} onBlur={() => saveSettings({ tunnelBinaryPath: settings.tunnelBinaryPath })} placeholder="Automatic (recommended)" /></div>
            <div className="setting-row"><div><strong>Tunnel ID</strong><span>Control-plane tunnel identity. Normal users should receive this automatically from OWL LAB.</span></div><input className="setting-input" value={settings.tunnelId} onChange={(e) => setSettings({ ...settings, tunnelId: e.target.value })} onBlur={() => saveSettings({ tunnelId: settings.tunnelId })} placeholder="tunnel_…" /></div>
            <div className="setting-group-label"><Cloud size={14} /><span>Cloud Bridge</span></div>
            <div className="setting-row"><div><strong>OWL Cloud Bridge</strong><span>Connect this registered Desktop to OWL Cloud control plane.</span></div><Toggle checked={settings.cloudEnabled} onChange={(v) => saveSettings({ cloudEnabled: v })} /></div>
            <div className="setting-row"><div><strong>Cloud auto-start</strong><span>Start heartbeat, command pull and projection outbox after Desktop launches.</span></div><Toggle checked={settings.cloudAutoStart} onChange={(v) => saveSettings({ cloudAutoStart: v })} /></div>
            <div className="setting-row"><div><strong>Cloud API endpoint</strong><span>OWL Cloud HTTP API. Device transport uses its separately stored credential.</span></div><input className="setting-input" value={settings.cloudBaseUrl} onChange={(e) => setSettings({ ...settings, cloudBaseUrl: e.target.value })} onBlur={() => saveSettings({ cloudBaseUrl: settings.cloudBaseUrl })} placeholder="https://…" /></div>
            <div className="setting-row"><div><strong>Cloud device ID</strong><span>Canonical device ID returned by Cloud registration.</span></div><input className="setting-input" value={settings.cloudDeviceId} onChange={(e) => setSettings({ ...settings, cloudDeviceId: e.target.value })} onBlur={() => saveSettings({ cloudDeviceId: settings.cloudDeviceId })} placeholder="dev_…" /></div>
            <div className="contract-note compact-note"><KeyRound size={17} /><div><strong>Secrets remain OS-encrypted.</strong><p>Transport and device credentials stay in the local secure store. Raw credentials are never shown in this panel.</p></div></div>
          </details>
          <section className="panel">
            <div className="panel-heading">
              <div><span className="eyebrow">STORAGE & EVIDENCE</span><h3>OWL LAB product data</h3></div>
              <span className={`neutral-pill ${(env?.storage?.migration.errors ?? 0) > 0 ? "warning-pill" : ""}`}>
                {env?.storage ? `layout v${env.storage.version}` : "legacy layout"}
              </span>
            </div>
            <p className="panel-help">Internal OWL LAB product data is managed by Desktop and Runtime. It is not a user Allowed Folder and does not require adding ~/Library to filesystem permissions.</p>
            <div className="about-grid">
              <span>Product root</span><code>{env?.storage?.productRoot ?? "Available after next Desktop restart"}</code>
              <span>Desktop state</span><code>{env?.storage?.desktopRoot ?? "—"}</code>
              <span>Task staging</span><code>{env?.storage?.stagingRoot ?? "—"}</code>
              <span>Logs</span><code>{env?.storage?.logsRoot ?? "—"}</code>
              <span>Cache</span><code>{env?.storage?.cacheRoot ?? "—"}</code>
              <span>Diagnostics</span><code>{env?.storage?.diagnosticsRoot ?? "—"}</code>
              <span>Migration</span><strong>{!env?.storage ? "Pending restart" : env.storage.migration.errors > 0 ? `${env.storage.migration.errors} error(s)` : env.storage.migration.legacyDetected ? `${env.storage.migration.copied} copied · ${env.storage.migration.preservedExisting} preserved` : "Canonical / no legacy state found"}</strong>
              <span>Evidence</span><code>{env?.storage?.migrationReportFile ?? "—"}</code>
            </div>
            <div className="contract-note compact-note">
              <HardDrive size={17} />
              <div><strong>Product storage stays separate from workspaces.</strong><p>Desktop/Documents/Downloads and folders you explicitly add remain Runtime workspace policy. OWL LAB internal state is surfaced through product APIs and diagnostics instead of broad filesystem access.</p></div>
            </div>
          </section>
          <section className="panel"><div className="panel-heading"><div><span className="eyebrow">ABOUT</span><h3>Local installation</h3></div></div><div className="about-grid"><span>Desktop</span><strong>{env?.appVersion}</strong><span>Electron</span><strong>{env?.electronVersion}</strong><span>Platform</span><strong>{env?.platform} / {env?.arch}</strong><span>Session</span><code>{sessionShort}</code></div></section>
        </>}
      </div>
    </main>
  </div>;
}
