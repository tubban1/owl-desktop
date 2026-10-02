export function tunnelTransportAvailable(status) {
  const reachability = status?.reachability;
  return Boolean(
    status?.state === "running" &&
      reachability?.state === "ready" &&
      reachability?.localReady === true &&
      reachability?.controlPlane?.status === "ok",
  );
}
