import { awaitAbortable } from "../../shared/abortable-await.mjs";

const boundedTimeout = (value, fallback) =>
  Math.min(Math.max(Number(value) || fallback, 1), 120_000);

function connectionHostError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

export class ConnectionHostClient {
  constructor({
    baseUrl,
    token,
    fetchImpl = fetch,
    defaultTimeoutMs = 5_000,
  } = {}) {
    if (!baseUrl) throw new Error("ConnectionHostClient requires baseUrl.");
    if (!token) throw new Error("ConnectionHostClient requires token.");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.defaultTimeoutMs = boundedTimeout(defaultTimeoutMs, 5_000);
  }

  async request(
    path,
    {
      method = "GET",
      body,
      timeoutMs = this.defaultTimeoutMs,
      signal,
    } = {},
  ) {
    const effectiveTimeoutMs = boundedTimeout(timeoutMs, this.defaultTimeoutMs);
    const controller = new AbortController();
    let timedOut = false;

    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new Error(`Connection Host request timed out after ${effectiveTimeoutMs}ms`),
      );
    }, effectiveTimeoutMs);
    timeout.unref?.();

    try {
      let response;
      try {
        response = await awaitAbortable(
          this.fetchImpl(this.baseUrl + path, {
            method,
            headers: {
              authorization: `Bearer ${this.token}`,
              ...(body ? { "content-type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: controller.signal,
          }),
          controller.signal,
        );
      } catch (cause) {
        if (timedOut) {
          throw connectionHostError(
            "CONNECTION_HOST_TIMEOUT",
            `OWL Connection Host did not respond within ${effectiveTimeoutMs}ms.`,
            cause,
          );
        }
        if (signal?.aborted) {
          throw connectionHostError(
            "CONNECTION_HOST_ABORTED",
            "OWL Connection Host request was cancelled.",
            cause,
          );
        }
        throw connectionHostError(
          "CONNECTION_HOST_UNAVAILABLE",
          "OWL Connection Host is temporarily unavailable.",
          cause,
        );
      }

      let payload;
      try {
        payload = await awaitAbortable(
          response.json(),
          controller.signal,
        );
      } catch (cause) {
        if (timedOut) {
          throw connectionHostError(
            "CONNECTION_HOST_TIMEOUT",
            `OWL Connection Host did not finish responding within ${effectiveTimeoutMs}ms.`,
            cause,
          );
        }
        if (signal?.aborted) {
          throw connectionHostError(
            "CONNECTION_HOST_ABORTED",
            "OWL Connection Host request was cancelled.",
            cause,
          );
        }
        payload = {};
      }

      if (!response.ok || payload?.ok === false) {
        const error = new Error(
          payload?.error?.message ||
            `OWL Connection Host failed with HTTP ${response.status}.`,
        );
        error.code =
          payload?.error?.code || "CONNECTION_HOST_REQUEST_FAILED";
        throw error;
      }
      return payload?.result ?? payload;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  health(options = {}) {
    return this.request("/health", {
      ...options,
      timeoutMs: options.timeoutMs ?? 3_000,
    });
  }

  startTunnel(config, options = {}) {
    return this.request("/tunnel/start", {
      method: "POST",
      body: config,
      ...options,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
  }

  restartTunnel(config, options = {}) {
    return this.request("/tunnel/restart", {
      method: "POST",
      body: config,
      ...options,
      timeoutMs: options.timeoutMs ?? 45_000,
    });
  }

  stopTunnel(options = {}) {
    return this.request("/tunnel/stop", {
      method: "POST",
      ...options,
      timeoutMs: options.timeoutMs ?? 15_000,
    });
  }

  configureCloudMcp(config, options = {}) {
    return this.request("/cloud-mcp/configure", {
      method: "POST",
      body: config,
      ...options,
      timeoutMs: options.timeoutMs ?? 15_000,
    });
  }

  stopCloudMcp(options = {}) {
    return this.request("/cloud-mcp/stop", {
      method: "POST",
      ...options,
      timeoutMs: options.timeoutMs ?? 10_000,
    });
  }
}
