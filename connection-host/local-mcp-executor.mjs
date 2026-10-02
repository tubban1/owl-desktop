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
    this.lastError = null;
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

  async execute({
    callId,
    ownerId,
    toolName,
    arguments: args = {},
    signal,
  }) {
    if (!callId || !toolName) {
      throw new Error("Local MCP call requires callId and toolName.");
    }
    const isolatedOwnerId = ownerId?.trim() || `cloud-call:${callId}`;
    const headers = {
      "x-owl-owner-id": isolatedOwnerId,
      "x-owl-idempotency-key": `cloud-mcp-call:${callId}`,
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
      // Readiness is proven by a real MCP operation, not process liveness.
      await client.listTools();
      this.lastProofAt = new Date().toISOString();
      this.lastError = null;
      const result = await client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: controller.signal },
      );
      this.lastProofAt = new Date().toISOString();
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
    }
  }

  snapshot() {
    return {
      lastProofAt: this.lastProofAt,
      lastError: this.lastError,
    };
  }
}
