#!/usr/bin/env tsx
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CloudHttpClient } from "../electron/services/cloud-http-client.mjs";
import { CloudControlPlaneService } from "../electron/services/cloud-control-plane-service.mjs";
import { CloudBridgeService } from "../electron/services/cloud-bridge-service.mjs";
import { CloudBridgeStore } from "../electron/services/cloud-bridge-store.mjs";
import { RemoteSubmissionStore } from "../electron/services/remote-submission-store.mjs";
import { RemoteDeviceControlService } from "../electron/services/remote-device-control-service.mjs";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const cloudSourceDir = process.env.OWL_CLOUD_SOURCE_DIR?.trim();
if (!cloudSourceDir) {
  throw new Error("OWL_CLOUD_SOURCE_DIR is required.");
}
const runtimeBaseUrl =
  process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:18788";
const repo =
  process.env.OWL_E2E_REPO?.trim() ||
  "/Users/wahaha/Documents/Me/Project/cursor/owl-desktop";

const importCloud = async (relative: string) =>
  import(pathToFileURL(path.join(cloudSourceDir, relative)).href);
const { createApiHandler } = await importCloud("src/api/router.ts");
const { buildPublicAuthConfig } = await importCloud("src/contracts/auth-config.ts");
const { CloudControlService } = await importCloud(
  "src/domain/cloud-control-service.ts",
);
const { InMemoryControlPlaneStore } = await importCloud("src/store/memory-store.ts");

const cloudStore = new InMemoryControlPlaneStore();
const cloudService = new CloudControlService(cloudStore);
const handler = createApiHandler(cloudService, {
  auth: buildPublicAuthConfig({
    region: "eu-central-1",
    issuer: "https://issuer.example.test",
    clientId: "multi-device-product-live",
    authBaseUrl: "https://auth.example.test",
  }),
});

const cloudServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    const headers = Object.fromEntries(
      Object.entries(req.headers)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, value as string]),
    );
    const authorization = headers.authorization ?? "";
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);
    const event: any = {
      version: "2.0",
      routeKey: "$default",
      rawPath: url.pathname,
      rawQueryString: url.searchParams.toString(),
      headers,
      queryStringParameters:
        url.searchParams.size > 0
          ? Object.fromEntries(url.searchParams.entries())
          : undefined,
      requestContext: {
        accountId: "multi-device",
        apiId: "multi-device",
        domainName: "127.0.0.1",
        domainPrefix: "multi-device",
        http: {
          method: req.method ?? "GET",
          path: url.pathname,
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "multi-device-product-live",
        },
        requestId: "multi-device-" + Date.now().toString(36),
        routeKey: "$default",
        stage: "$default",
        time: new Date().toUTCString(),
        timeEpoch: Date.now(),
        ...(bearer
          ? {
              authorizer: {
                jwt: {
                  claims: {
                    sub: bearer[1],
                    email: bearer[1] + "@example.test",
                    name: "Multi Device E2E",
                  },
                  scopes: [],
                },
              },
            }
          : {}),
      },
      body: body || undefined,
      isBase64Encoded: false,
    };
    const result = await handler(event);
    res.statusCode = result.statusCode ?? 200;
    for (const [key, value] of Object.entries(result.headers ?? {})) {
      if (value !== undefined) res.setHeader(key, String(value));
    }
    res.end(result.body ?? "");
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

await new Promise<void>((resolve, reject) => {
  cloudServer.once("error", reject);
  cloudServer.listen(0, "127.0.0.1", resolve);
});
const cloudAddress = cloudServer.address();
assert(cloudAddress && typeof cloudAddress === "object");
const cloudBaseUrl = "http://127.0.0.1:" + String(cloudAddress.port);

const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "owl-multi-device-product-live-"),
);
const userJwt = "multi-device-product-user";
const refreshToken = "fixture-refresh-token";
const userCloud = new CloudHttpClient({ baseUrl: cloudBaseUrl });
const bootstrap = await userCloud.bootstrap(userJwt);
const registered = await userCloud.registerDevice(userJwt, {
  displayName: "Multi-device Product Live",
  platform: process.platform + "-" + process.arch,
  capabilities: {
    remoteTask: true,
    verification: true,
  },
  runtimeCompatibility: {
    runtimeApi: "0.1",
  },
});

const auth = {
  refresh: async (token: string) => {
    assert.equal(token, refreshToken);
    return { idToken: userJwt, refreshToken };
  },
};
const authStore = {
  readSecret: (name: string, project?: string) =>
    name === "OWL_CLOUD_ACCOUNT_REFRESH_TOKEN" && project === "owl-cloud"
      ? refreshToken
      : undefined,
  upsertSecret: () => undefined,
};
const controlPlane = new CloudControlPlaneService({
  cloudClient: userCloud,
  auth,
  store: authStore,
});
const submissionStore = new RemoteSubmissionStore({
  file: path.join(scratch, "remote-submissions.json"),
});
const remoteControl = new RemoteDeviceControlService({
  controlPlane,
  store: submissionStore,
});

const runtime = new RuntimeHttpClient({
  baseUrl: runtimeBaseUrl,
  sessionId: "owl-desktop:multi-device-product-live",
});
const runtimeInfo = await runtime.info();

const deviceCloud = new CloudHttpClient({
  baseUrl: cloudBaseUrl,
  deviceCredential: registered.deviceCredential,
});
const bridgeStore = new CloudBridgeStore({
  file: path.join(scratch, "bridge.json"),
});
const bridge = new CloudBridgeService({
  client: deviceCloud,
  runtimeClient: runtime,
  store: bridgeStore,
  deviceId: registered.deviceId,
  appVersion: "0.1.0-multi-device-live",
  pollIntervalMs: 1_000,
  presenceIntervalMs: 5_000,
  buildPresence: async () => ({
    capabilities: {
      remoteTask: true,
      verification: true,
    },
    runtimeCompatibility: {
      apiVersion: runtimeInfo.apiVersion,
      runtimeVersion: runtimeInfo.runtimeVersion,
    },
  }),
});

const mcp = await startOwlMcpHttpServer({
  port: 0,
  runtimeBaseUrl,
  remoteDeviceControl: remoteControl,
});
const client = new Client({
  name: "multi-device-product-live",
  version: "0.1.0",
});
const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
  requestInit: {
    headers: { "x-owl-owner-id": "multi-device-product-live-owner" },
  },
});

const parseTool = (result: any) =>
  JSON.parse(
    (result.content ?? [])
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("\n"),
  );

let runtimeTaskId: string | null = null;
try {
  await client.connect(transport);

  const devices = parseTool(
    await client.callTool({ name: "device_list", arguments: {} }),
  );
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceId, registered.deviceId);

  const submissionId = "multi-device-live-" + Date.now().toString(36);
  const orchestrationId =
    "orch_multi_device_live_" + Date.now().toString(36);
  const submitArgs = {
    submission_id: submissionId,
    device_id: registered.deviceId,
    label: "Multi-device MCP product-live read",
    steps: [
      {
        id: "read",
        action: "fs.read",
        args: { path: path.join(repo, "package.json") },
      },
    ],
    max_concurrency: 1,
    fail_fast: true,
    orchestration_id: orchestrationId,
    orchestration_label: "Multi-device product-live",
  };

  const submitResult = await client.callTool({
    name: "remote_task_submit",
    arguments: submitArgs,
  });
  if (submitResult.isError) {
    throw new Error(
      "remote_task_submit failed: " +
        (submitResult.content ?? [])
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text)
          .join("\n"),
    );
  }
  const submitted = parseTool(submitResult);
  assert.equal(submitted.accepted, true);
  assert.equal(submitted.idempotent, false);
  assert.ok(submitted.commandId);

  await bridge.syncOnce({ forceHeartbeat: true });

  let status: any = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await bridge.syncOnce();
    status = parseTool(
      await client.callTool({
        name: "remote_task_status",
        arguments: { submission_id: submissionId },
      }),
    );
    if (status.terminal?.status) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  if (!status?.runtimeTaskId) {
    const directCommands = await controlPlane
      .listCommands(registered.deviceId, 100)
      .catch((error: any) => [{
        error: error?.code ?? error?.message ?? String(error),
      }]);
    const terminalProbe = await controlPlane
      .findTaskTerminalEvent(registered.deviceId, submitted.commandId, 100)
      .catch((error: any) => ({
        error: error?.code ?? error?.message ?? String(error),
      }));
    console.error(
      JSON.stringify(
        {
          productLiveFailure: "REMOTE_RUNTIME_TASK_ID_MISSING",
          submitted,
          mcpStatus: status,
          bridge: bridge.snapshot(),
          bridgeJournal: bridgeStore.getCommand(submitted.commandId),
          directCloudCommands: directCommands,
          terminalProbe,
        },
        null,
        2,
      ),
    );
  }
  assert.ok(status?.runtimeTaskId);
  runtimeTaskId = status.runtimeTaskId;
  assert.equal(status.commandStatus, "accepted");
  assert.equal(status.terminal?.status, "completed");
  assert.equal(status.terminal?.runtimeTaskId, runtimeTaskId);

  const runtimeTask = await runtime.getTask(runtimeTaskId, false);
  assert.equal(runtimeTask.status, "completed");
  assert.equal(runtimeTask.progress.terminal, true);
  assert.equal(
    runtimeTask.orchestration?.orchestrationId,
    orchestrationId,
  );

  const replay = parseTool(
    await client.callTool({
      name: "remote_task_submit",
      arguments: submitArgs,
    }),
  );
  assert.equal(replay.commandId, submitted.commandId);
  assert.equal(replay.idempotent, true);

  const commands = parseTool(
    await client.callTool({
      name: "device_commands",
      arguments: {
        device_id: registered.deviceId,
        limit: 25,
      },
    }),
  );
  const matching = commands.filter(
    (command: any) =>
      command.clientSubmissionId === submitted.clientSubmissionId,
  );
  assert.equal(matching.length, 1);

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtimeVersion: runtimeInfo.runtimeVersion,
        deviceList: true,
        explicitDeviceId: registered.deviceId,
        remoteSubmissionId: submissionId,
        commandId: submitted.commandId,
        runtimeTaskId,
        remoteTaskTerminal: status.terminal.status,
        orchestrationPreserved: true,
        replayStable: true,
        duplicateCommands: matching.length,
      },
      null,
      2,
    ),
  );
} finally {
  await transport.close().catch(() => undefined);
  await mcp.close().catch(() => undefined);
  if (runtimeTaskId) {
    await runtime
      .invoke("tasks.delete", { taskId: runtimeTaskId }, { timeoutMs: 10_000 })
      .catch(async () => {
        await runtime
          .invoke("tasks.cancel", { taskId: runtimeTaskId }, { timeoutMs: 10_000 })
          .catch(() => undefined);
        await runtime
          .invoke("tasks.delete", { taskId: runtimeTaskId }, { timeoutMs: 10_000 })
          .catch(() => undefined);
      });
  }
  await bridge.stop().catch(() => undefined);
  await new Promise<void>((resolve) => cloudServer.close(() => resolve()));
  fs.rmSync(scratch, { recursive: true, force: true });
}
