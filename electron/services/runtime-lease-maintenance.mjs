/**
 * Renewable signed Runtime access. Cloud continues to issue grants; Runtime
 * alone verifies them. Desktop only schedules existing authenticated refresh.
 */
export function createRuntimeLeaseMaintenance({
  getCloudState, inspectRuntimeAccess, recover, onEvent = () => {},
  now = () => Date.now(),
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
  intervalMs = 60_000, renewAheadMs = 15 * 60_000,
} = {}) {
  if (typeof getCloudState !== "function" ||
      typeof inspectRuntimeAccess !== "function" ||
      typeof recover !== "function")
    throw new Error("Runtime lease maintenance requires state, inspection and recovery functions.");
  let timer = null, inFlight = null, stopped = false, last = null;
  const eligible = cloud =>
    cloud?.status === "ready" &&
    cloud?.access?.canRun === true &&
    cloud?.entitlement?.canRun === true &&
    cloud?.entitlement?.features?.runtime === true;
  const shouldRenew = (access, at = now()) => {
    if (!access || access.mode === "compat" || access.state === "REVOKED") return false;
    if (access.state !== "READY") return true;
    const expiration = Date.parse(access.grant?.expiresAt ?? "");
    return !Number.isFinite(expiration) || expiration - at <= renewAheadMs;
  };
  function check(reason = "periodic") {
    if (stopped || !eligible(getCloudState())) return Promise.resolve(null);
    if (inFlight) return inFlight;
    const pending = (async () => {
      let access;
      try { access = await inspectRuntimeAccess(); }
      catch (error) {
        onEvent("warn", "Runtime access inspection temporarily unavailable", {
          code:error?.code ?? "RUNTIME_ACCESS_PROBE_FAILED", reason,
        });
        return null;
      }
      if (!shouldRenew(access)) return access;
      const recovered = await recover(); // Existing deduplicated 45s retry gate.
      const valid = recovered?.state === "READY" &&
        Number.isFinite(Date.parse(recovered.grant?.expiresAt ?? "")) &&
        Date.parse(recovered.grant.expiresAt) > now();
      if (valid) {
        last = {status:"renewed",at:new Date(now()).toISOString(),
          expiresAt:recovered.grant.expiresAt,reason};
        onEvent("info", "Runtime authorization lease renewed automatically", {
          expiresAt:recovered.grant.expiresAt,reason,
        });
      } else {
        last = {status:"not_ready",at:new Date(now()).toISOString(),
          state:recovered?.state ?? null,reason};
        if (recovered?.state && recovered.state !== "READY")
          onEvent("warn", "Runtime authorization remains unavailable", {
            state:recovered.state,reason,
          });
      }
      return recovered;
    })();
    inFlight = pending;
    void pending.then(() => {
      if (inFlight === pending) inFlight = null;
    }, () => {
      if (inFlight === pending) inFlight = null;
    });
    return pending;
  }
  return {
    start() {
      if (timer) return;
      stopped = false;
      timer = setIntervalImpl(() => {void check().catch(error => onEvent(
        "warn", "Runtime lease renewal attempt failed", {
          code:error?.code ?? "RUNTIME_LEASE_RENEW_FAILED",
        },
      ));}, Math.max(5_000, intervalMs));
      timer?.unref?.();
    },
    check, shouldRenew,
    stop() {
      stopped = true;
      if (timer !== null) clearIntervalImpl(timer);
      timer = null;
    },
    snapshot:() => ({running:timer!==null,renewalInFlight:inFlight!==null,last}),
  };
}
