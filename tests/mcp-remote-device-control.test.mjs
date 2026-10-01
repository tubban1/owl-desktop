import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers = [];

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function startFakeRuntime() {
  const server = http.createServer(async (_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        apiVersion: "0.1",
        result: { apiVersion: "0.1", runtimeVersion: "test-runtime" },
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return "http://127.0.0.1:" + server.address().port;
}

function parse(result) {
  return JSON.parse(
    (result.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  );
}

async function connect(url, owner) {
  const client = new Client({ name: "remote-device-test", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { "x-owl-owner-id": owner } },
  });
  await client.connect(transport);
  closers.push(() => transport.close().catch(() => undefined));
  return { client, transport };
}

describe("OWL MCP multi-device control", () => {
  it("keeps remote submission ownership stable across MCP transports", async () => {
    const runtimeBaseUrl = await startFakeRuntime();
    const seen = [];
    const remoteDeviceControl = {
      listDevices: vi.fn(async () => [
        {
          deviceId: "dev_1",
          displayName: "Mac mini",
          registrationState: "active",
        },
      ]),
      listCommands: vi.fn(async () => []),
      submitTask: vi.fn(async (input) => {
        seen.push(input);
        return {
          accepted: true,
          submissionId: input.submissionId,
          deviceId: input.deviceId,
          commandId: "cmd_1",
          doNotCreateReplacementCommand: true,
        };
      }),
      status: vi.fn(async (input) => ({
        submissionId: input.submissionId,
        commandId: "cmd_1",
        commandStatus: "accepted",
        runtimeTaskId: "task_remote",
        terminal: null,
      })),
      cancel: vi.fn(async (input) => ({
        submissionId: input.submissionId,
        commandId: "cmd_1",
        cancelled: true,
      })),
    };

    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl,
      remoteDeviceControl,
    });
    closers.push(() => mcp.close());

    const a = await connect(mcp.url, "chatgpt:conversation:remote-1");
    const devices = parse(
      await a.client.callTool({ name: "device_list", arguments: {} }),
    );
    expect(devices[0]).toMatchObject({
      deviceId: "dev_1",
      displayName: "Mac mini",
    });

    const args = {
      submission_id: "remote-release-1",
      device_id: "dev_1",
      label: "Remote release check",
      steps: [
        {
          id: "inspect",
          action: "runtime.info",
          args: {},
        },
        {
          id: "confirm",
          action: "runtime.info",
          args: {},
          depends_on: ["inspect"],
        },
      ],
      max_concurrency: 1,
      fail_fast: true,
      orchestration_id: "orch_release",
      orchestration_label: "OWL LAB release",
      parent_task_id: "task_parent",
    };

    const first = parse(
      await a.client.callTool({
        name: "remote_task_submit",
        arguments: args,
      }),
    );
    expect(first).toMatchObject({
      accepted: true,
      submissionId: "remote-release-1",
      commandId: "cmd_1",
    });
    await a.transport.close();

    const b = await connect(mcp.url, "chatgpt:conversation:remote-1");
    const replay = parse(
      await b.client.callTool({
        name: "remote_task_submit",
        arguments: args,
      }),
    );
    expect(replay.commandId).toBe("cmd_1");

    expect(seen).toHaveLength(2);
    expect(seen[0].ownerId).toBe(seen[1].ownerId);
    expect(seen[0].ownerId).toMatch(/^owl-owner:/);
    expect(seen[0]).toMatchObject({
      submissionId: "remote-release-1",
      deviceId: "dev_1",
      label: "Remote release check",
      steps: [
        {
          id: "inspect",
          action: "runtime.info",
          args: {},
        },
        {
          id: "confirm",
          action: "runtime.info",
          args: {},
          dependsOn: ["inspect"],
        },
      ],
      maxConcurrency: 1,
      failFast: true,
      orchestration: {
        orchestrationId: "orch_release",
        label: "OWL LAB release",
        parentTaskId: "task_parent",
      },
    });

    const status = parse(
      await b.client.callTool({
        name: "remote_task_status",
        arguments: { submission_id: "remote-release-1" },
      }),
    );
    expect(status).toMatchObject({
      commandStatus: "accepted",
      runtimeTaskId: "task_remote",
    });
    expect(remoteDeviceControl.status.mock.calls[0][0].ownerId).toBe(
      seen[0].ownerId,
    );

    const cancelled = parse(
      await b.client.callTool({
        name: "remote_task_cancel",
        arguments: { submission_id: "remote-release-1" },
      }),
    );
    expect(cancelled.cancelled).toBe(true);
    expect(remoteDeviceControl.cancel.mock.calls[0][0].ownerId).toBe(
      seen[0].ownerId,
    );
  });
});
