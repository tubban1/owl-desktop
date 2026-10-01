import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  FolderOpen,
  GitBranch,
  Globe2,
  Laptop,
  MousePointer2,
  Play,
  Puzzle,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Wifi,
  WifiOff,
} from "lucide-react";
import type {
  CloudDeviceSummary,
  CloudRemoteCommandSummary,
} from "../types";

function bool(value: unknown): boolean {
  return value === true;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nested(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return object(source[key]);
}

function onlineState(lastSeenAt: string | null, now = Date.now()) {
  if (!lastSeenAt) {
    return { state: "offline", label: "Never seen", ageMs: null as number | null };
  }
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) {
    return { state: "offline", label: "Unknown", ageMs: null as number | null };
  }
  const ageMs = Math.max(0, now - seen);
  if (ageMs <= 90_000) return { state: "online", label: "Online", ageMs };
  if (ageMs <= 5 * 60_000) return { state: "stale", label: "Recently online", ageMs };
  return { state: "offline", label: "Offline", ageMs };
}

function ageLabel(ageMs: number | null) {
  if (ageMs === null) return "—";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function shortId(value: string) {
  return value.length > 22 ? value.slice(0, 12) + "…" + value.slice(-6) : value;
}

function commandTone(status: string) {
  if (["accepted"].includes(status)) return "healthy";
  if (["queued", "dispatched"].includes(status)) return "active";
  if (["rejected", "expired"].includes(status)) return "attention";
  return "neutral";
}

function Capability({
  label,
  available,
  detail,
  icon: Icon,
}: {
  label: string;
  available: boolean;
  detail?: string;
  icon: typeof Terminal;
}) {
  return (
    <div className={"device-capability " + (available ? "available" : "missing")}>
      <Icon size={14} />
      <div>
        <strong>{label}</strong>
        <span>{detail ?? (available ? "Available" : "Unavailable")}</span>
      </div>
      {available ? <CheckCircle2 size={13} /> : <Ban size={13} />}
    </div>
  );
}

export function DevicesPage({
  accountReady,
  currentDeviceId,
}: {
  accountReady: boolean;
  currentDeviceId: string | null;
}) {
  const [devices, setDevices] = useState<CloudDeviceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commands, setCommands] = useState<CloudRemoteCommandSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const loadDevices = async () => {
    if (!accountReady) {
      setDevices([]);
      setCommands([]);
      return;
    }
    const next = await window.owlDesktop.cloudListDevices();
    setDevices(next);
    setSelectedId((current) => {
      if (current && next.some((device) => device.deviceId === current)) {
        return current;
      }
      if (
        currentDeviceId &&
        next.some((device) => device.deviceId === currentDeviceId)
      ) {
        return currentDeviceId;
      }
      return next[0]?.deviceId ?? null;
    });
  };

  const loadCommands = async (deviceId = selectedId) => {
    if (!accountReady || !deviceId) {
      setCommands([]);
      return;
    }
    setCommands(await window.owlDesktop.cloudListCommands(deviceId, 30));
  };

  const refresh = async () => {
    if (!accountReady) return;
    setLoading(true);
    try {
      await loadDevices();
      if (selectedId) await loadCommands(selectedId);
      setNow(Date.now());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDevices().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [accountReady, currentDeviceId]);

  useEffect(() => {
    if (!selectedId || !accountReady) return;
    void loadCommands(selectedId).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [selectedId, accountReady]);

  useEffect(() => {
    if (!accountReady) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void loadDevices().catch(() => undefined);
      if (selectedId) void loadCommands(selectedId).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [accountReady, selectedId]);

  const selected = useMemo(
    () => devices.find((device) => device.deviceId === selectedId) ?? null,
    [devices, selectedId],
  );

  const selectedCapabilities = object(selected?.capabilities);
  const authorization = nested(selectedCapabilities, "authorization");
  const usage = nested(selectedCapabilities, "usage");
  const providers = nested(selectedCapabilities, "providers");
  const filesystem = nested(providers, "filesystem");
  const shell = nested(providers, "shell");
  const git = nested(providers, "git");
  const browser = nested(providers, "browser");
  const desktop = nested(providers, "desktop");
  const remoteKinds = Array.isArray(selectedCapabilities.supportedRemoteCommands)
    ? selectedCapabilities.supportedRemoteCommands.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const runtimeAccessState =
    typeof authorization.runtimeAccessState === "string"
      ? authorization.runtimeAccessState
      : null;
  const remoteRunReady =
    bool(selectedCapabilities.runtimeReachable) &&
    (runtimeAccessState === null || runtimeAccessState === "READY") &&
    remoteKinds.includes("runtime.task.create-and-start@1");

  const runHealthCheck = async () => {
    if (!selected) return;
    setSending(true);
    try {
      await window.owlDesktop.cloudCreateCommand(selected.deviceId, {
        kind: "runtime.task.create-and-start",
        payload: {
          label: `Remote health check · ${selected.displayName}`,
          steps: [
            {
              id: "runtime-info",
              action: "runtime.info",
              args: {},
            },
          ],
          maxConcurrency: 1,
          failFast: true,
        },
      });
      await loadCommands(selected.deviceId);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  if (!accountReady) {
    return (
      <>
        <div className="section-header">
          <div>
            <h1>Devices</h1>
            <p>Run durable work on another OWL LAB device through Cloud.</p>
          </div>
        </div>
        <section className="panel devices-empty-state">
          <CloudDeviceIllustration />
          <div>
            <h3>Sign in to use your devices</h3>
            <p>
              Device inventory and remote tasks use your OWL LAB account. Tokens
              remain in the Desktop main process and OS Vault.
            </p>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="section-header">
        <div>
          <h1>Devices</h1>
          <p>
            Choose where OWL should run. Capabilities come from each device's
            live Runtime heartbeat.
          </p>
        </div>
        <button className="secondary" onClick={refresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="inline-warning device-error">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      <div className="devices-layout">
        <section className="panel device-list-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">MY DEVICES</span>
              <h3>{devices.length} enrolled</h3>
            </div>
          </div>
          <div className="device-list">
            {devices.map((device) => {
              const presence = onlineState(device.lastSeenAt, now);
              const isCurrent = device.deviceId === currentDeviceId;
              return (
                <button
                  key={device.deviceId}
                  className={
                    "device-list-item " +
                    (selectedId === device.deviceId ? "selected" : "")
                  }
                  onClick={() => setSelectedId(device.deviceId)}
                >
                  <span className={"device-presence " + presence.state}>
                    {presence.state === "online" ? (
                      <Wifi size={14} />
                    ) : (
                      <WifiOff size={14} />
                    )}
                  </span>
                  <div>
                    <strong>{device.displayName}</strong>
                    <span>
                      {presence.label} · {ageLabel(presence.ageMs)}
                    </span>
                  </div>
                  {isCurrent && <span className="current-device-pill">This Mac</span>}
                </button>
              );
            })}
            {devices.length === 0 && (
              <div className="empty">No enrolled devices are visible to this account.</div>
            )}
          </div>
        </section>

        <section className="panel device-detail-panel">
          {selected ? (
            <>
              <div className="device-detail-hero">
                <div className="device-large-icon">
                  {selected.platform.includes("darwin") ? (
                    <Laptop size={25} />
                  ) : (
                    <Server size={25} />
                  )}
                </div>
                <div>
                  <div className="device-title-row">
                    <h2>{selected.displayName}</h2>
                    {selected.deviceId === currentDeviceId && (
                      <span className="current-device-pill">This Mac</span>
                    )}
                  </div>
                  <p>
                    {selected.platform} ·{" "}
                    {String(
                      selected.runtimeCompatibility.runtimeVersion ??
                        "Runtime version unknown",
                    )}
                  </p>
                  <code title={selected.deviceId}>{shortId(selected.deviceId)}</code>
                </div>
                <div className="device-detail-actions">
                  <button
                    className="primary"
                    disabled={!remoteRunReady || sending}
                    onClick={runHealthCheck}
                    title={
                      remoteRunReady
                        ? "Queue a read-only Runtime health task on this device"
                        : "This device has not advertised remote task execution"
                    }
                  >
                    <Play size={14} />
                    {sending ? "Sending…" : "Run test"}
                  </button>
                </div>
              </div>

              <div className="about-grid">
                <span>Operational state</span>
                <strong>{String(authorization.operationalState ?? "Unknown").replaceAll("_", " ")}</strong>
                <span>Account session</span>
                <strong>{String(authorization.accountSessionState ?? "Unknown").replaceAll("_", " ")}</strong>
                <span>Entitlement</span>
                <strong>{String(authorization.entitlementStatus ?? "Unknown").replaceAll("_", " ")}</strong>
                <span>Runtime access</span>
                <strong>{String(authorization.runtimeAccessState ?? "Unknown")}</strong>
                <span>Lease</span>
                <strong>{bool(authorization.signatureVerified) ? "Cloud signed" : "Not active"}</strong>
                <span>Lease expires</span>
                <strong>{typeof authorization.leaseExpiresAt === "string" ? new Date(authorization.leaseExpiresAt).toLocaleString() : "—"}</strong>
                <span>Active tasks</span>
                <strong>{Number(usage.activeTasks ?? 0)}</strong>
                <span>Processes</span>
                <strong>{Number(usage.activeProcesses ?? 0)}</strong>
                <span>Approvals pending</span>
                <strong>{Number(usage.approvalsPending ?? 0)}</strong>
                <span>MCP sessions</span>
                <strong>{Number(usage.mcpSessions ?? 0)}</strong>
                <span>Usage sampled</span>
                <strong>{typeof usage.sampledAt === "string" ? new Date(usage.sampledAt).toLocaleTimeString() : "—"}</strong>
              </div>

              <div className="device-capability-grid">
                <Capability
                  label="Files"
                  icon={FolderOpen}
                  available={bool(filesystem.available)}
                  detail={
                    bool(filesystem.available)
                      ? bool(filesystem.write)
                        ? "Read + write"
                        : "Read only"
                      : undefined
                  }
                />
                <Capability
                  label="Shell"
                  icon={Terminal}
                  available={bool(shell.available)}
                />
                <Capability
                  label="Git"
                  icon={GitBranch}
                  available={bool(git.available)}
                  detail={
                    bool(git.available)
                      ? bool(git.push)
                        ? "Query + push"
                        : "Push disabled"
                      : undefined
                  }
                />
                <Capability
                  label="Browser"
                  icon={Globe2}
                  available={bool(browser.available)}
                />
                <Capability
                  label="Desktop"
                  icon={MousePointer2}
                  available={bool(desktop.available)}
                />
                <Capability
                  label="Skills"
                  icon={Puzzle}
                  available={bool(selectedCapabilities.skillRegistry)}
                />
                <Capability
                  label="Verification"
                  icon={ShieldCheck}
                  available={bool(selectedCapabilities.verification)}
                />
                <Capability
                  label="Remote tasks"
                  icon={Server}
                  available={remoteRunReady}
                />
              </div>

              <div className="device-command-heading">
                <div>
                  <span className="eyebrow">REMOTE WORK</span>
                  <h3>Recent tasks sent by you</h3>
                </div>
                <span className="neutral-pill">{commands.length}</span>
              </div>
              <div className="device-command-list">
                {commands.map((command) => (
                  <article key={command.commandId}>
                    <span className={"command-status-dot " + commandTone(command.status)} />
                    <div className="device-command-copy">
                      <strong>{command.label}</strong>
                      <span>
                        {command.kind} · {shortId(command.commandId)}
                      </span>
                      {command.runtimeTaskId && (
                        <code>Runtime {shortId(command.runtimeTaskId)}</code>
                      )}
                    </div>
                    <div className="device-command-meta">
                      <span className={"command-status " + commandTone(command.status)}>
                        {command.status.replaceAll("_", " ")}
                      </span>
                      <time>
                        {command.createdAt
                          ? new Date(command.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })
                          : "—"}
                      </time>
                      {["queued", "dispatched"].includes(command.status) && (
                        <button
                          className="text-button danger-text"
                          onClick={async () => {
                            try {
                              await window.owlDesktop.cloudCancelCommand(
                                command.commandId,
                              );
                              await loadCommands(selected.deviceId);
                            } catch (cause) {
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : String(cause),
                              );
                            }
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {commands.length === 0 && (
                  <div className="empty">
                    No remote tasks sent to this device yet.
                  </div>
                )}
              </div>

              <div className="device-routing-note">
                <Clock3 size={15} />
                <p>
                  Device routing happens above Primitive ABI. The selected
                  device receives a Cloud RemoteCommand, then its local Desktop
                  hands the durable Task to its own Runtime. Individual
                  primitives remain local execution semantics.
                </p>
              </div>
            </>
          ) : (
            <div className="empty">Select an OWL LAB device.</div>
          )}
        </section>
      </div>
    </>
  );
}

function CloudDeviceIllustration() {
  return (
    <div className="cloud-device-illustration">
      <Laptop size={28} />
      <span>→</span>
      <Server size={28} />
    </div>
  );
}
