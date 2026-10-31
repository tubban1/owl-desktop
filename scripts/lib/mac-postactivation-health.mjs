import path from "node:path";

// DEV releases run exactly one Electron main process with 'electron .'.
// Electron helpers / a process from another checkout do not count.
export function macDesktopMainPresent(releaseRoot, psOutput) {
  const executable = path.join(releaseRoot, "node_modules", "electron", "dist",
    "Electron.app", "Contents", "MacOS", "Electron");
  return String(psOutput).split("\n").some((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) return false;
    const command = match[2].trim();
    return command === executable + " ." || command.startsWith(executable + " . ");
  });
}

/** Determine the smallest safe action from independently measured components.
 * A UI-only outage must not terminate a healthy, authorized Runtime/MCP.
 * Core failures get multiple probes and at least five minutes of recovery time.
 */
export function macWatchdogDecision({
  probe, firstSeenAt, consecutiveFailures = 0, now = Date.now(),
}) {
  const coreHealthy = Boolean(probe.supervisorPresent && probe.mcp?.ok &&
    probe.runtime?.ok);
  const fullHealthy = coreHealthy && probe.desktopMainPresent && probe.ownerVerified;
  if (fullHealthy) return { action: "clear", reason: "all-components-healthy" };
  if (coreHealthy) {
    return { action: "degraded", reason: probe.desktopMainPresent
      ? "owner-receipt-uncertain" : "desktop-only-unhealthy" };
  }
  // Both ports may belong to an unfamiliar or transitioning supervisor.
  // Never kick another owner or roll back while the services respond.
  if (probe.mcp?.ok && probe.runtime?.ok) {
    return { action: "degraded", reason: "supervisor-identity-uncertain" };
  }
  const firstMs = Date.parse(firstSeenAt ?? "");
  if (!Number.isFinite(firstMs) || now < firstMs || consecutiveFailures < 2) {
    return { action: "observe", reason: "insufficient-evidence" };
  }
  const ageMs = now - firstMs;
  if (ageMs >= 300_000 && consecutiveFailures >= 6) {
    return { action: "rollback", reason: "persistent-core-failure" };
  }
  if (!probe.supervisorPresent && ageMs >= 60_000 && consecutiveFailures >= 3) {
    return { action: "restart", reason: "supervisor-missing" };
  }
  return { action: "wait", reason: "core-recovery-grace" };
}

// Kept for legacy callers of the pure recovery contract; new watchdog uses
// macWatchdogDecision with independent component evidence.
export function postActivationRecoveryAction({
  healthy, firstSeenAt, now = Date.now(), supervisorPresent = true,
}) {
  if (healthy) return "clear";
  if (!firstSeenAt || !Number.isFinite(Date.parse(firstSeenAt))) return "observe";
  const age = now - Date.parse(firstSeenAt);
  if (age < 0) return "observe";
  if (age >= 300_000) return "rollback";
  if (age >= 60_000 && !supervisorPresent) return "restart";
  return "wait";
}
