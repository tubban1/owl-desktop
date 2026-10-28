/**
 * Avoid flapping the MCP UI on a single slow localhost health request.
 * An initial unsuccessful probe is still reported immediately. Once a host
 * has been confirmed healthy, an outage needs repeated failures over time.
 */
export function createHealthHysteresis({ failures = 2, graceMs = 8_000 } = {}) {
  let hasSucceeded = false;
  let firstFailureAt = null;
  let consecutiveFailures = 0;
  return {
    success() {
      hasSucceeded = true;
      firstFailureAt = null;
      consecutiveFailures = 0;
    },
    failure(now = Date.now()) {
      if (!hasSucceeded) return true;
      if (firstFailureAt === null) firstFailureAt = now;
      consecutiveFailures += 1;
      return consecutiveFailures >= failures && (now - firstFailureAt) >= graceMs;
    },
  };
}
