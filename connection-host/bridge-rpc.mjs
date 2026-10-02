const boundedTimeout = (value, fallback) =>
  Math.min(Math.max(Number(value) || fallback, 1), 120_000);

function bridgeError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

export function createDesktopBridgeRpc({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = 5_000,
  onEvent = () => {},
} = {}) {
  if (!baseUrl) throw new Error("Desktop bridge RPC requires baseUrl.");
  if (!token) throw new Error("Desktop bridge RPC requires token.");

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const defaultTimeoutMs = boundedTimeout(timeoutMs, 5_000);

  return async function bridgeRpc(domain, method, args = [], options = {}) {
    const effectiveTimeoutMs = boundedTimeout(
      options.timeoutMs,
      defaultTimeoutMs,
    );
    const controller = new AbortController();
    let timedOut = false;
    const callerSignal = options.signal;

    const onAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) onAbort();
    else callerSignal?.addEventListener("abort", onAbort, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new Error(
          `Desktop capability bridge RPC timed out after ${effectiveTimeoutMs}ms`,
        ),
      );
    }, effectiveTimeoutMs);
    timeout.unref?.();

    try {
      let response;
      try {
        response = await fetchImpl(`${normalizedBaseUrl}/rpc`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ domain, method, args }),
          signal: controller.signal,
        });
      } catch (cause) {
        if (timedOut) {
          onEvent("warn", "Desktop capability bridge RPC timed out", {
            domain,
            method,
            timeoutMs: effectiveTimeoutMs,
          });
          throw bridgeError(
            "DESKTOP_BRIDGE_TIMEOUT",
            `OWL Desktop capability bridge did not respond within ${effectiveTimeoutMs}ms.`,
            cause,
          );
        }
        if (callerSignal?.aborted) {
          throw bridgeError(
            "DESKTOP_BRIDGE_ABORTED",
            "OWL Desktop capability bridge request was cancelled.",
            cause,
          );
        }
        onEvent("warn", "Desktop capability bridge unavailable", {
          domain,
          method,
        });
        throw bridgeError(
          "DESKTOP_BRIDGE_UNAVAILABLE",
          "OWL Desktop capability bridge is temporarily unavailable.",
          cause,
        );
      }

      let body;
      try {
        body = await response.json();
      } catch (cause) {
        if (timedOut) {
          onEvent("warn", "Desktop capability bridge response timed out", {
            domain,
            method,
            timeoutMs: effectiveTimeoutMs,
          });
          throw bridgeError(
            "DESKTOP_BRIDGE_TIMEOUT",
            `OWL Desktop capability bridge did not finish responding within ${effectiveTimeoutMs}ms.`,
            cause,
          );
        }
        if (callerSignal?.aborted) {
          throw bridgeError(
            "DESKTOP_BRIDGE_ABORTED",
            "OWL Desktop capability bridge request was cancelled.",
            cause,
          );
        }
        body = {};
      }

      if (!response.ok || body?.ok !== true) {
        const error = new Error(
          body?.error?.message ||
            `OWL Desktop capability bridge failed with HTTP ${response.status}.`,
        );
        error.code = body?.error?.code || "DESKTOP_BRIDGE_UNAVAILABLE";
        throw error;
      }

      return body.result;
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onAbort);
    }
  };
}
