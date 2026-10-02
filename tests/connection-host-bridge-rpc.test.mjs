import { describe, expect, it } from "vitest";
import { createDesktopBridgeRpc } from "../connection-host/bridge-rpc.mjs";

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

describe("Desktop capability bridge bounded RPC", () => {
  it("returns a successful bridge result", async () => {
    const rpc = createDesktopBridgeRpc({
      baseUrl: "http://127.0.0.1:8792",
      token: "bridge-token",
      fetchImpl: async (_url, init) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.headers.authorization).toBe("Bearer bridge-token");
        return response({ ok: true, result: { count: 3 } });
      },
    });

    await expect(rpc("agentInbox", "summary")).resolves.toEqual({ count: 3 });
  });

  it("fails a stalled Electron bridge within the configured deadline", async () => {
    const events = [];
    const rpc = createDesktopBridgeRpc({
      baseUrl: "http://127.0.0.1:8792",
      token: "bridge-token",
      timeoutMs: 20,
      fetchImpl: hangingFetch,
      onEvent: (level, message, meta) => events.push({ level, message, meta }),
    });

    await expect(rpc("agentInbox", "summary")).rejects.toMatchObject({
      code: "DESKTOP_BRIDGE_TIMEOUT",
    });
    expect(events).toContainEqual({
      level: "warn",
      message: "Desktop capability bridge RPC timed out",
      meta: {
        domain: "agentInbox",
        method: "summary",
        timeoutMs: 20,
      },
    });
  });

  it("distinguishes unavailable bridge from timeout", async () => {
    const rpc = createDesktopBridgeRpc({
      baseUrl: "http://127.0.0.1:8792",
      token: "bridge-token",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    await expect(rpc("remoteDevice", "status")).rejects.toMatchObject({
      code: "DESKTOP_BRIDGE_UNAVAILABLE",
    });
  });

  it("preserves application errors returned by the bridge", async () => {
    const rpc = createDesktopBridgeRpc({
      baseUrl: "http://127.0.0.1:8792",
      token: "bridge-token",
      fetchImpl: async () =>
        response(
          {
            ok: false,
            error: { code: "REQUEST_NOT_FOUND", message: "Missing request." },
          },
          { ok: false, status: 404 },
        ),
    });

    await expect(rpc("agentInbox", "claim", ["missing"])).rejects.toMatchObject({
      code: "REQUEST_NOT_FOUND",
      message: "Missing request.",
    });
  });
});
