import { afterEach, describe, expect, it, vi } from "vitest";
import { DevAuthCallbackServer } from "../electron/services/dev-auth-callback-server.mjs";

const servers = [];

afterEach(async () => {
  while (servers.length) await servers.pop()?.stop();
});

describe("DevAuthCallbackServer", () => {
  it("accepts one loopback callback and forwards the full URL", async () => {
    const onCallback = vi.fn(async () => undefined);
    const server = new DevAuthCallbackServer({
      port: 18992,
      onCallback,
      timeoutMs: 5000,
    });
    servers.push(server);
    await server.start();

    const response = await fetch(
      "http://127.0.0.1:18992/auth/callback?code=abc&state=xyz",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("login complete");
    expect(onCallback).toHaveBeenCalledWith(
      "http://127.0.0.1:18992/auth/callback?code=abc&state=xyz",
    );
  });

  it("rejects unrelated paths without invoking OAuth completion", async () => {
    const onCallback = vi.fn();
    const server = new DevAuthCallbackServer({
      port: 18993,
      onCallback,
      timeoutMs: 5000,
    });
    servers.push(server);
    await server.start();

    const response = await fetch("http://127.0.0.1:18993/not-auth");
    expect(response.status).toBe(404);
    expect(onCallback).not.toHaveBeenCalled();
  });

  it("returns a bounded failure page when completion fails", async () => {
    const server = new DevAuthCallbackServer({
      port: 18994,
      onCallback: async () => {
        throw new Error("state mismatch");
      },
      timeoutMs: 5000,
    });
    servers.push(server);
    await server.start();

    const response = await fetch(
      "http://127.0.0.1:18994/auth/callback?code=abc&state=bad",
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("state mismatch");
  });
});
