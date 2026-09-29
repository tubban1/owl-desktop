import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderTelemetryTransport } from "../electron/services/provider-telemetry-transport.mjs";

const tempDirs = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

function event(id, severity = "info") {
  return {
    eventId: id,
    eventType: "runtime.rpc.failed",
    eventVersion: 1,
    occurredAt: "2026-09-29T09:00:00.000Z",
    producer: "owl-runtime",
    severity,
    component: "runtime.http",
    componentVersion: "1.0.0-rc.4",
    operation: "health",
    errorCode: severity === "info" ? undefined : "TEST_ERROR",
    errorFingerprint:
      severity === "info" ? undefined : "runtime_rpc:health:TEST_ERROR",
    attributes: { architecture: "arm64" },
  };
}

async function stateFile() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "owl-provider-telemetry-"),
  );
  tempDirs.push(directory);
  return path.join(directory, "telemetry.json");
}

describe("ProviderTelemetryTransport", () => {
  it("persists Runtime telemetry before Cloud upload and retries without losing it", async () => {
    const file = await stateFile();
    const runtimeClient = {
      telemetry: vi.fn().mockResolvedValue({
        events: [
          { cursor: 1, event: event("evt-1", "error") },
          { cursor: 2, event: event("evt-2") },
        ],
        nextCursor: 2,
      }),
    };
    const failedFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "UNAVAILABLE", message: "try later" }),
    });
    const transport = new ProviderTelemetryTransport({
      runtimeClient,
      cloudBaseUrl: "https://cloud.example.test/",
      deviceCredential: "owldev1.dev.secret",
      stateFile: file,
      fetchImpl: failedFetch,
    });

    const queued = await transport.ingestRuntimeOnce();
    expect(queued.ingested).toBe(2);
    expect(await transport.status()).toMatchObject({
      runtimeCursor: 2,
      pending: 2,
    });

    const persisted = await fs.readFile(file, "utf8");
    expect(persisted).not.toContain("owldev1.dev.secret");

    await expect(transport.flushCloudOnce()).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect((await transport.status()).pending).toBe(2);

    transport.fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ accepted: 2, duplicates: 0 }),
    });

    const flushed = await transport.flushCloudOnce();
    expect(flushed).toMatchObject({
      uploaded: 2,
      duplicates: 0,
      pending: 0,
      runtimeCursor: 2,
    });

    const [, request] = transport.fetchImpl.mock.calls[0];
    expect(request.headers.authorization).toBe("Device owldev1.dev.secret");
    expect(JSON.parse(request.body).events.map((item) => item.eventId)).toEqual([
      "evt-1",
      "evt-2",
    ]);
  });

  it("rejects sensitive Runtime attributes before queueing or upload", async () => {
    const file = await stateFile();
    const runtimeClient = {
      telemetry: vi.fn().mockResolvedValue({
        events: [
          {
            cursor: 1,
            event: {
              ...event("evt-sensitive"),
              attributes: { accessToken: "must-not-upload" },
            },
          },
        ],
      }),
    };
    const fetchImpl = vi.fn();
    const transport = new ProviderTelemetryTransport({
      runtimeClient,
      cloudBaseUrl: "https://cloud.example.test",
      deviceCredential: "owldev1.dev.secret",
      stateFile: file,
      fetchImpl,
    });

    await expect(transport.ingestRuntimeOnce()).rejects.toThrow(
      "RUNTIME_TELEMETRY_SENSITIVE_ATTRIBUTE",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await transport.status()).pending).toBe(0);
  });

  it("accepts Cloud duplicate acknowledgements as successful delivery", async () => {
    const file = await stateFile();
    const transport = new ProviderTelemetryTransport({
      runtimeClient: {
        telemetry: vi.fn().mockResolvedValue({
          events: [{ cursor: 1, event: event("evt-replay") }],
        }),
      },
      cloudBaseUrl: "https://cloud.example.test",
      deviceCredential: "owldev1.dev.secret",
      stateFile: file,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({ accepted: 0, duplicates: 1 }),
      }),
    });

    await transport.ingestRuntimeOnce();
    const result = await transport.flushCloudOnce();
    expect(result).toMatchObject({
      uploaded: 0,
      duplicates: 1,
      pending: 0,
    });
  });
});
