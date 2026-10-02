import { describe, expect, it } from "vitest";
import { ConnectionHostClient } from "../electron/services/connection-host-client.mjs";

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

function hangingFetch(_url, { signal }) {
  return new Promise((_, reject) => {
    const abort = () => reject(signal.reason ?? new Error("aborted"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

describe("ConnectionHostClient bounded RPC", () => {
  it("returns a healthy response without changing the payload contract", async () => {
    const client = new ConnectionHostClient({
      baseUrl: "http://127.0.0.1:8791",
      token: "test-token",
      fetchImpl: async (_url, init) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.headers.authorization).toBe("Bearer test-token");
        return response({ ok: true, result: { service: "host" } });
      },
    });

    await expect(client.health()).resolves.toEqual({ service: "host" });
  });

  it("fails a stalled host with a deterministic timeout instead of hanging", async () => {
    const client = new ConnectionHostClient({
      baseUrl: "http://127.0.0.1:8791",
      token: "test-token",
      fetchImpl: hangingFetch,
    });

    await expect(client.health({ timeoutMs: 20 })).rejects.toMatchObject({
      code: "CONNECTION_HOST_TIMEOUT",
    });
  });

  it("distinguishes caller cancellation from a transport timeout", async () => {
    const client = new ConnectionHostClient({
      baseUrl: "http://127.0.0.1:8791",
      token: "test-token",
      fetchImpl: hangingFetch,
    });
    const controller = new AbortController();
    const pending = client.request("/health", {
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    controller.abort(new Error("test cancellation"));

    await expect(pending).rejects.toMatchObject({
      code: "CONNECTION_HOST_ABORTED",
    });
  });

  it("wraps connection failures as unavailable", async () => {
    const client = new ConnectionHostClient({
      baseUrl: "http://127.0.0.1:8791",
      token: "test-token",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    await expect(client.health()).rejects.toMatchObject({
      code: "CONNECTION_HOST_UNAVAILABLE",
    });
  });

  it("preserves application error codes returned by the host", async () => {
    const client = new ConnectionHostClient({
      baseUrl: "http://127.0.0.1:8791",
      token: "test-token",
      fetchImpl: async () =>
        response(
          {
            ok: false,
            error: { code: "TUNNEL_BUSY", message: "Tunnel is busy." },
          },
          { ok: false, status: 409 },
        ),
    });

    await expect(client.restartTunnel({})).rejects.toMatchObject({
      code: "TUNNEL_BUSY",
      message: "Tunnel is busy.",
    });
  });
});
