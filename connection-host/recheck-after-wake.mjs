// Readiness is unproven after system resume until both transports revalidate.
export async function recheckConnectivityAfterWake({ tunnelSupervisor, cloudMcpConsumer } = {}) {
  const tunnelActive = tunnelSupervisor?.status?.()?.desiredRunning === true;
  const cloudActive = cloudMcpConsumer?.running === true;
  if (tunnelActive) tunnelSupervisor.markWakePending();
  if (cloudActive) cloudMcpConsumer.markWakePending();
  const [tunnel, cloudMcp] = await Promise.allSettled([
    tunnelActive ? tunnelSupervisor.checkHealthNow() : Promise.resolve(null),
    cloudActive
      ? cloudMcpConsumer.revalidateAfterWake({ alreadyInvalidated: true })
      : Promise.resolve(null),
  ]);
  const t = tunnel.status === "fulfilled" ? tunnel.value : null;
  const c = cloudMcp.status === "fulfilled" ? cloudMcp.value : null;
  return {
    tunnelChecked: tunnelActive,
    cloudMcpChecked: cloudActive,
    tunnel: t && {
      state: t.reachability?.state ?? t.state ?? "unknown",
      ready: t.reachability?.state === "ready",
      errorCode: t.reachability?.lastError?.code ?? null,
    },
    cloudMcp: c && {
      state: c.state,
      ready: c.ready === true,
      errorCode: c.lastError?.code ?? null,
    },
    errors: [
      ...(tunnel.status === "rejected" ? [{ component: "tunnel", code: tunnel.reason?.code ?? "TUNNEL_WAKE_RECHECK_FAILED" }] : []),
      ...(cloudMcp.status === "rejected" ? [{ component: "cloudMcp", code: cloudMcp.reason?.code ?? "CLOUD_WAKE_RECHECK_FAILED" }] : []),
    ],
  };
}
