export function createConnectivityWakeRecovery({
  reconcile,
  onEvent = () => {},
} = {}) {
  if (typeof reconcile !== "function") {
    throw new Error("Connectivity wake recovery requires reconcile().");
  }

  let inFlight = null;
  let pending = false;
  let runs = 0;
  let lastReason = null;

  const trigger = (reason = "system_resume") => {
    lastReason = reason;
    if (inFlight) {
      pending = true;
      onEvent("info", "Connectivity wake recovery coalesced", { reason });
      return inFlight;
    }

    inFlight = (async () => {
      do {
        pending = false;
        runs += 1;
        const currentReason = lastReason || reason;
        onEvent("info", "Connectivity wake recovery started", {
          reason: currentReason,
          run: runs,
        });
        try {
          await reconcile();
          onEvent("info", "Connectivity wake recovery completed", {
            reason: currentReason,
            run: runs,
          });
        } catch (error) {
          onEvent("warn", "Connectivity wake recovery failed", {
            reason: currentReason,
            run: runs,
            code: error?.code ?? error?.name ?? "ERROR",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } while (pending);
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  };

  return {
    trigger,
    snapshot() {
      return {
        running: Boolean(inFlight),
        pending,
        runs,
        lastReason,
      };
    },
  };
}
