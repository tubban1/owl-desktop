import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function bounded(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(Math.max(resolved, minimum), maximum);
}

export class LocalMcpExecutor {
  constructor({
    mcpUrl,
    mcpToken,
    connectTimeoutMs = 8_000,
    callTimeoutMs = 120_000,
    onEvent = () => {},
  } = {}) {
    if (!mcpUrl) throw new Error("LocalMcpExecutor requires mcpUrl.");
    this.mcpUrl = mcpUrl;
    this.mcpToken = mcpToken;
    this.connectTimeoutMs = bounded(connectTimeoutMs, 8_000, 500, 30_000);
    this.callTimeoutMs = bounded(callTimeoutMs, 120_000, 1_000, 600_000);
    this.onEvent = onEvent;
    this.lastProofAt = null;
    this.lastLivenessProofAt = null;
    this.lastError = null;
    this.lastCallTiming = null;
  }

  async probe({ signal } = {}) {
    const headers = {
      ...(this.mcpToken ? { authorization: `Bearer ${this.mcpToken}` } : {}),
    };
    const client = new Client({
      name: "owl-connectivity-host-readiness",
      version: "1.1.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl), {
      requestInit: { headers },
    });
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error("Local MCP readiness probe timed out.")),
      this.connectTimeoutMs,
    );
    timer.unref?.();

    try {
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(controller.signal.reason ?? new Error("aborted")),
            { once: true },
          );
        }),
      ]);
      await client.listTools(undefined, { signal: controller.signal });
      this.lastProofAt = new Date().toISOString();
      this.lastLivenessProofAt = this.lastProofAt;
      this.lastError = null;
      return this.snapshot();
    } catch (error) {
      this.lastError = {
        at: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
      this.onEvent("warn", "Local MCP readiness probe failed", {
        message: this.lastError.message,
      });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      await transport.close().catch(() => undefined);
    }
  }

  // A high-frequency readiness check must not establish an entire MCP
  // transport and call tools/list every minute. /health verifies both the
  // local MCP HTTP listener and its downstream Runtime without adding an
  // MCP Session. Full protocol proof still runs at startup, after wake,
  // after errors, and periodically in CloudMcpCallConsumer.
  async probeLightweight({ signal } = {}) {
    const url = new URL("/health", this.mcpUrl);
    const timeout = AbortSignal.timeout(this.connectTimeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.mcpToken
          ? { authorization: `Bearer ${this.mcpToken}` } : {},
        signal: combinedSignal,
      });
      if (!response.ok) {
        const error = new Error("Local MCP health endpoint was unavailable.");
        error.code = "LOCAL_MCP_HEALTH_HTTP_ERROR";
        throw error;
      }
      const health = await response.json();
      if (health?.ok !== true || health?.service !== "owl-mcp") {
        const error = new Error("Local MCP returned an unhealthy health projection.");
        error.code = "LOCAL_MCP_HEALTH_INVALID";
        throw error;
      }
      this.lastLivenessProofAt = new Date().toISOString();
      this.lastError = null;
      return this.snapshot();
    } catch (error) {
      this.lastError = {
        at: new Date().toISOString(),
        code: error?.code ?? "LOCAL_MCP_LIVENESS_FAILED",
        message: error instanceof Error ? error.message : String(error),
      };
      this.onEvent("warn", "Local MCP lightweight readiness probe failed", {
        code: this.lastError.code,
      });
      throw error;
    }
  }

  async execute({
    callId,
    ownerId,
    toolName,
    arguments: args = {},
    traceId,
    onTiming,
    signal,
  }) {
    if (!callId || !toolName) {
      throw new Error("Local MCP call requires callId and toolName.");
    }
    const startedAt = performance.now();
    let connectedAt = null;
    let executionCompletedAt = null;
    let succeeded = false;
    const isolatedOwnerId = ownerId?.trim() || `cloud-call:${callId}`;
    const headers = {
      "x-owl-owner-id": isolatedOwnerId,
      "x-owl-idempotency-key": `cloud-mcp-call:${callId}`,
      "x-owl-trace-id": String(traceId || callId).slice(0, 100),
      ...(this.mcpToken ? { authorization: `Bearer ${this.mcpToken}` } : {}),
    };
    const client = new Client({
      name: "owl-connectivity-host",
      version: "1.1.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl), {
      requestInit: { headers },
    });
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Local MCP call timed out.")),
      this.callTimeoutMs,
    );
    timeout.unref?.();

    try {
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => {
          const timer = setTimeout(() => {
            reject(new Error("Local MCP connect timed out."));
          }, this.connectTimeoutMs);
          timer.unref?.();
          controller.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(controller.signal.reason ?? new Error("aborted"));
            },
            { once: true },
          );
        }),
      ]);
      // A real tools/call proves MCP and Runtime readiness. Re-fetching the
      // 161-tool catalog before EVERY call is redundant and expensive.
      // Full tools/list conformance remains in probe() at startup/recovery.
      connectedAt = performance.now();
      const result = await client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: controller.signal },
      );
      executionCompletedAt = performance.now();
      succeeded = true;
      this.lastProofAt = new Date().toISOString();
      this.lastLivenessProofAt = this.lastProofAt;
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = {
        at: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
      this.onEvent("warn", "Local MCP execution failed", {
        callId,
        toolName,
        message: this.lastError.message,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      await transport.close().catch(() => undefined);
      const finishedAt = performance.now();
      this.lastCallTiming = {
        toolName: toolName.slice(0, 100),
        succeeded,
        connectMs: connectedAt === null ? null : Math.round(connectedAt - startedAt),
        toolMs: connectedAt === null ? null
          : Math.round((executionCompletedAt ?? finishedAt) - connectedAt),
        totalMs: Math.round(finishedAt - startedAt),
        measuredAt: new Date().toISOString(),
      };
      // Call-scoped receipt avoids racing on lastCallTiming when multiple
      // independent workstreams execute concurrently.
      onTiming?.({ ...this.lastCallTiming });
    }
  }

  snapshot() {
    return {
      lastProofAt: this.lastProofAt,
      lastLivenessProofAt: this.lastLivenessProofAt,
      lastError: this.lastError,
      lastCallTiming: this.lastCallTiming,
    };
  }
}
