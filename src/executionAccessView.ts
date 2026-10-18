import type { RuntimeSnapshot } from "./types";

export type ExecutionAccessView = "ready" | "verifying" | "unavailable" | "locked";

/** Only a fresh Runtime response can establish execution authority.
 * Cloud account projections may be stale during Desktop boot or reconnection.
 */
export function executionAccessView(
  runtimeOnline: boolean,
  runtimeAccess: RuntimeSnapshot["runtimeAccess"] | null | undefined,
  probeError?: RuntimeSnapshot["runtimeAccessError"],
): ExecutionAccessView {
  if (!runtimeOnline) return "verifying";
  if (!runtimeAccess) return probeError ? "unavailable" : "verifying";
  if (runtimeAccess.mode === "compat" || runtimeAccess.state === "READY") return "ready";
  return "locked";
}
