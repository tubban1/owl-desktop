import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("RuntimeHttpClient", () => {
  it("preserves stable logical session headers and reports HTTP transport", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: { apiVersion: "0.1", runtimeVersion: "1.0.0-rc.4", transport: "in-process" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RuntimeHttpClient({
      baseUrl: "http://127.0.0.1:8788/",
      sessionId: "owl-desktop:test-session",
      token: "test-token",
    });
    const info = await client.info();

    expect(info.transport).toBe("http");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8788/runtime/v0.1/rpc");
    expect(options.headers["x-owl-session-id"]).toBe("owl-desktop:test-session");
    expect(options.headers.authorization).toBe("Bearer test-token");
  });

  it("fails closed on Runtime RPC errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        error: { code: "PROCESS_OWNED", message: "owned by another session" },
      }),
    }));
    const client = new RuntimeHttpClient({
      baseUrl: "http://127.0.0.1:8788",
      sessionId: "owl-desktop:test-session",
    });

    await expect(client.processes()).rejects.toMatchObject({
      message: "owned by another session",
      code: "PROCESS_OWNED",
    });
  });
});
