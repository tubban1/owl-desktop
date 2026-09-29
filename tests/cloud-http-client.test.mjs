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
  it("reads public auth and command registry discovery without auth headers", async () => {
    const fetchImpl = vi.fn(async (url) =>
      jsonResponse(
        url.endsWith("/auth/config")
          ? { provider: "cognito", pkce: { required: true, method: "S256" } }
          : { contractVersion: 1, kinds: [] },
      ),
    );
    const client = new CloudHttpClient({
      baseUrl: "https://cloud.example.test",
      fetchImpl,
    });

    await client.authConfig();
    await client.remoteCommandRegistry();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.headers.authorization).toBeUndefined();
    }
  });

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
