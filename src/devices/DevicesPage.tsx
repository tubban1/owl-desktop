import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  GitBranch,
  Globe2,
  History,
  Laptop,
  MousePointer2,
  Puzzle,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { CloudDeviceSummary } from "../types";

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
  if (ageMs <= 5 * 60_000) {
    return { state: "stale", label: "Recently online", ageMs };
  }
  return { state: "offline", label: "Offline", ageMs };
}

function ageLabel(ageMs: number | null) {
  if (ageMs === null) return "—";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortId(value: string) {
  return value.length > 22
    ? value.slice(0, 12) + "…" + value.slice(-6)
    : value;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const activeDevices = useMemo(
    () => devices.filter((device) => device.registrationState === "active"),
    [devices],
  );
  const deviceHistory = useMemo(
    () => devices.filter((device) => device.registrationState !== "active"),
    [devices],
  );

  const loadDevices = async () => {
    if (!accountReady) {
      setDevices([]);
      setSelectedId(null);
      return;
    }
    const next = await window.owlDesktop.cloudListDevices();
    setDevices(next);
    const active = next.filter(
      (device) => device.registrationState === "active",
    );
    setSelectedId((current) => {
      if (current && active.some((device) => device.deviceId === current)) {
        return current;
      }
      if (
        currentDeviceId &&
        active.some((device) => device.deviceId === currentDeviceId)
      ) {
        return currentDeviceId;
      }
      return active[0]?.deviceId ?? null;
    });
  };

  const refresh = async () => {
    if (!accountReady) return;
    setLoading(true);
    try {
      await loadDevices();
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
    if (!accountReady) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void loadDevices().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [accountReady, currentDeviceId]);

  const selected = useMemo(
    () =>
      activeDevices.find((device) => device.deviceId === selectedId) ?? null,
    [activeDevices, selectedId],
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
  const remoteKinds = Array.isArray(
    selectedCapabilities.supportedRemoteCommands,
  )
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

  if (!accountReady) {
    return (
      <>
        <div className="section-header">
          <div>
            <h1>Devices</h1>
            <p>See which computers are enrolled and authorized for OWL LAB.</p>
          </div>
        </div>
        <section className="panel devices-empty-state">
          <CloudDeviceIllustration />
          <div>
            <h3>Sign in to view your devices</h3>
            <p>
              Device identity, authorization and presence are owned by your
              OWL LAB account. Device credentials remain in the OS Vault.
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
            Current computers authorized for OWL LAB. Historical registrations
            stay available for audit without cluttering the active fleet.
          </p>
        </div>
        <button className="secondary" onClick={refresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="inline-warning device-error">
          <span>{error}</span>
        </div>
      )}

      <div className="devices-layout">
        <section className="panel device-list-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ACTIVE DEVICES</span>
              <h3>
                {activeDevices.length} active
                {activeDevices.length === 1 ? " device" : " devices"}
              </h3>
            </div>
          </div>

          <div className="device-list">
            {activeDevices.map((device) => {
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
                  {isCurrent && (
                    <span className="current-device-pill">This Mac</span>
                  )}
                </button>
              );
            })}

            {activeDevices.length === 0 && (
              <div className="empty">
                No active device registration is visible to this account.
              </div>
            )}
          </div>

          {deviceHistory.length > 0 && (
            <details className="device-history">
              <summary>
                <History size={14} />
                <span>{deviceHistory.length} historical registration{deviceHistory.length === 1 ? "" : "s"}</span>
                <ChevronRight size={14} />
              </summary>
              <div className="device-history-list">
                {deviceHistory.map((device) => {
                  const presence = onlineState(device.lastSeenAt, now);
                  return (
                    <div className="device-history-row" key={device.deviceId}>
                      <WifiOff size={13} />
                      <div>
                        <strong>{device.displayName}</strong>
                        <span>
                          {device.registrationState} · last seen{" "}
                          {ageLabel(presence.ageMs)}
                        </span>
                      </div>
                      <code title={device.deviceId}>{shortId(device.deviceId)}</code>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
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
                  <code title={selected.deviceId}>
                    {shortId(selected.deviceId)}
                  </code>
                </div>
              </div>

              <div className="device-section-heading">
                <span className="eyebrow">AUTHORIZATION & PRESENCE</span>
                <strong>
                  {String(
                    authorization.operationalState ?? "Unknown",
                  ).replaceAll("_", " ")}
                </strong>
              </div>

              <div className="about-grid">
                <span>Account session</span>
                <strong>
                  {String(
                    authorization.accountSessionState ?? "Unknown",
                  ).replaceAll("_", " ")}
                </strong>
                <span>Entitlement</span>
                <strong>
                  {String(
                    authorization.entitlementStatus ?? "Unknown",
                  ).replaceAll("_", " ")}
                </strong>
                <span>Runtime access</span>
                <strong>
                  {String(authorization.runtimeAccessState ?? "Unknown")}
                </strong>
                <span>Lease</span>
                <strong>
                  {bool(authorization.signatureVerified)
                    ? "Cloud signed"
                    : "Not active"}
                </strong>
                <span>Lease expires</span>
                <strong>
                  {typeof authorization.leaseExpiresAt === "string"
                    ? new Date(
                        authorization.leaseExpiresAt,
                      ).toLocaleString()
                    : "—"}
                </strong>
                <span>Last presence</span>
                <strong>
                  {selected.lastSeenAt
                    ? ageLabel(
                        Math.max(
                          0,
                          now - Date.parse(selected.lastSeenAt),
                        ),
                      )
                    : "Never"}
                </strong>
              </div>

              <div className="device-section-heading">
                <span className="eyebrow">CURRENT USAGE</span>
                <strong>
                  {typeof usage.sampledAt === "string"
                    ? new Date(usage.sampledAt).toLocaleTimeString()
                    : "No sample"}
                </strong>
              </div>

              <div className="device-usage-strip">
                <div><span>Tasks</span><strong>{Number(usage.activeTasks ?? 0)}</strong></div>
                <div><span>Processes</span><strong>{Number(usage.activeProcesses ?? 0)}</strong></div>
                <div><span>Approvals</span><strong>{Number(usage.approvalsPending ?? 0)}</strong></div>
                <div><span>MCP sessions</span><strong>{Number(usage.mcpSessions ?? 0)}</strong></div>
              </div>

              <div className="device-section-heading">
                <span className="eyebrow">CAPABILITIES</span>
                <strong>
                  {remoteRunReady ? "Remote work ready" : "Local only / unavailable"}
                </strong>
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
                  label="Remote work"
                  icon={Server}
                  available={remoteRunReady}
                />
              </div>

              <div className="device-product-note">
                <ShieldCheck size={15} />
                <p>
                  This page describes device identity, authorization, presence and
                  capability. Actual agent work is started and observed in Monitor
                  or by a connected agent/Worker, not by a device test button.
                </p>
              </div>
            </>
          ) : (
            <div className="empty">Select an active OWL LAB device.</div>
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
