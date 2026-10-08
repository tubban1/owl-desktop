import type { RuntimeSnapshot } from "./types";

export type ExecutionAccessView = "ready" | "verifying" | "locked";

/** Only a fresh Runtime response can establish execution authority.
 * Cloud account projections may be stale during Desktop boot or reconnection.
 */
export function executionAccessView(
  runtimeOnline: boolean,
  runtimeAccess: RuntimeSnapshot["runtimeAccess"] | null | undefined,
): ExecutionAccessView {
  if (!runtimeOnline || !runtimeAccess) return "verifying";
  if (runtimeAccess.mode === "compat" || runtimeAccess.state === "READY") return "ready";
  return "locked";
}
