import { describe, expect, it, vi } from "vitest";
import {
  CloudHttpClient,
  CloudHttpError,
} from "../electron/services/cloud-http-client.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("CloudHttpClient", () => {
  it("uses Device auth for presence without exposing the credential elsewhere", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const client = new CloudHttpClient({
      baseUrl: "https://cloud.example.test/",
      deviceCredential: "owldev1.device.secret",
      fetchImpl,
    });

    await client.heartbeat({
      capabilities: { runtimeReachable: true },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://cloud.example.test/device/v1/presence");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Device owldev1.device.secret");
    expect(JSON.parse(init.body)).toEqual({
      capabilities: { runtimeReachable: true },
    });
  });

  it("uses Bearer auth for account-scoped device registration", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        deviceId: "dev_1",
        deviceCredential: "owldev1.dev_1.secret",
      }, 201),
    );
    const client = new CloudHttpClient({
      baseUrl: "https://cloud.example.test",
      fetchImpl,
    });

    const registered = await client.registerDevice("jwt-value", {
      displayName: "This Mac",
      platform: "darwin-arm64",
    });

    expect(registered.deviceId).toBe("dev_1");
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.authorization).toBe("Bearer jwt-value");
  });

  it("uses user auth for device inventory and remote command control", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith("/v1/devices")) {
        return jsonResponse({ devices: [] });
      }
      if (String(url).includes("/commands?limit=25")) {
        return jsonResponse({ commands: [] });
      }
      if (String(url).includes("/events?limit=50")) {
        return jsonResponse({ events: [] });
      }
      if (init.method === "POST") {
        return jsonResponse({
          commandId: "cmd_1",
          deviceId: "dev_1",
          kind: "runtime.task.create",
          kindVersion: 1,
          payload: { label: "test", steps: [{ id: "i", action: "runtime.info" }] },
          status: "queued",
          createdAt: "2026-10-01T18:00:00.000Z",
        }, 201);
      }
      return jsonResponse({
        commandId: "cmd_1",
        deviceId: "dev_1",
        kind: "runtime.task.create",
        kindVersion: 1,
        payload: {},
        status: "queued",
        createdAt: "2026-10-01T18:00:00.000Z",
      });
    });
    const client = new CloudHttpClient({
      baseUrl: "https://cloud.example.test",
      fetchImpl,
    });

    await client.listDevices("jwt");
    await client.listCommands("jwt", "dev_1", 25);
    await client.listDeviceEvents("jwt", "dev_1", 50);
    await client.createCommand("jwt", "dev_1", {
      kind: "runtime.task.create",
      kindVersion: 1,
      payload: { label: "test", steps: [{ id: "i", action: "runtime.info" }] },
    });
    await client.cancelCommand("jwt", "cmd_1");

    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.headers.authorization).toBe("Bearer jwt");
    }
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "https://cloud.example.test/v1/devices",
      "https://cloud.example.test/v1/devices/dev_1/commands?limit=25",
      "https://cloud.example.test/v1/devices/dev_1/events?limit=50",
      "https://cloud.example.test/v1/devices/dev_1/commands",
      "https://cloud.example.test/v1/commands/cmd_1/cancel",
    ]);
  });

  it("preserves Cloud error codes without including auth material", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: "UNAUTHORIZED", message: "Device revoked" },
        401,
      ),
    );
    const client = new CloudHttpClient({
      baseUrl: "https://cloud.example.test",
      deviceCredential: "owldev1.secret-material",
      fetchImpl,
    });

    await expect(client.pullCommands()).rejects.toMatchObject({
      name: "CloudHttpError",
      code: "UNAUTHORIZED",
      status: 401,
      message: "Device revoked",
    });
  });

  it("rejects device routes when the credential is missing", async () => {
    const client = new CloudHttpClient({
      baseUrl: "https://cloud.example.test",
      fetchImpl: vi.fn(),
    });

    await expect(client.pullCommands()).rejects.toBeInstanceOf(CloudHttpError);
    await expect(client.pullCommands()).rejects.toMatchObject({
      code: "DEVICE_CREDENTIAL_MISSING",
    });
  });

  it("classifies an aborted timeout as CLOUD_TIMEOUT", async () => {
    const fetchImpl = vi.fn(async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(init.signal.reason ?? new Error("aborted"));
        }, { once: true });
      }),
    );
    const client = new CloudHttpClient({
      baseUrl: "https://cloud.example.test",
      fetchImpl,
      timeoutMs: 5,
    });

    await expect(client.health()).rejects.toMatchObject({
      code: "CLOUD_TIMEOUT",
    });
  });
});
