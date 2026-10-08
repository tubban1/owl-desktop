// Rate-limit Cloud lease recovery and share one in-flight refresh between all
// Desktop Runtime snapshot callers. This does not grant execution access:
// Runtime alone verifies and authorizes each signed Cloud lease.
export function createRuntimeAccessRecoveryGate({
  recover,
  now = () => Date.now(),
  retryDelayMs = 45_000,
} = {}) {
  if (typeof recover !== "function") throw new Error("recover callback is required");
  let inFlight = null;
  let nextAllowedAt = 0;
  return {
    run({ force = false } = {}) {
      if (inFlight) return inFlight;
      if (!force && now() < nextAllowedAt) return Promise.resolve(null);
      // Delay before starting: even a failed/slow operation must not form a
      // retry storm via concurrent polling and cloud:account-updated events.
      nextAllowedAt = now() + retryDelayMs;
      const pending = Promise.resolve().then(recover);
      inFlight = pending;
      void pending.then(() => {
        if (inFlight === pending) inFlight = null;
      }, () => {
        if (inFlight === pending) inFlight = null;
      });
      return pending;
    },
    state() {
      return { running: inFlight !== null, retryAfterMs: Math.max(0, nextAllowedAt - now()) };
    },
  };
}
