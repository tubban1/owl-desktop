import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";

const closers = [];
const roots = [];

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function jsonText(result) {
  return JSON.parse(
    (result.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  );
}

async function startRuntime() {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = body ? JSON.parse(body) : {};
    let result;
    if (rpc.method === "tasks.list") result = [];
    else if (rpc.method === "info") {
      result = { apiVersion: "0.1", runtimeVersion: "test-runtime" };
    } else result = {};
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, apiVersion: "0.1", result }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return "http://127.0.0.1:" + server.address().port;
}

async function connect(url, ownerId, name) {
  const client = new Client({ name, version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: { "x-owl-owner-id": ownerId },
    },
  });
  await client.connect(transport);
  return { client, transport };
}

describe("planner continuation recovery", () => {
  it("recovers planning state after transport loss when Runtime has no active task", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-planner-recovery-"));
    roots.push(root);
    const file = path.join(root, "planner-continuation.json");
    const continuation = new PlannerContinuationStore({ file });
    const runtimeBaseUrl = await startRuntime();

    const firstMcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl,
      plannerContinuation: continuation,
    });
    closers.push(() => firstMcp.close());

    const a = await connect(firstMcp.url, "recovery-owner", "planner-a");
    const saved = jsonText(
      await a.client.callTool({
        name: "planner_checkpoint",
        arguments: {
          goal: "Finish multi-device integration",
          phase: "bridge tests",
          summary: "Cloud contract and bridge code are written.",
          completed: ["Cloud contract validator passes"],
          next_actions: [
            "run bridge targeted tests",
            "finish MCP remote submission tests",
          ],
          workspace: {
            repo: "owl-desktop",
            worktree: "/tmp/owl-desktop-remote-submit-v1",
            commit: "5f6abb4",
          },
          orchestration_id: "orch_multi_device",
        },
      }),
    );
    expect(saved.checkpoint).toMatchObject({
      revision: 1,
      status: "active",
      goal: "Finish multi-device integration",
      phase: "bridge tests",
    });

    await a.transport.close();
    expect(continuation.summary().latestActive).toMatchObject({
      checkpoint: {
        goal: "Finish multi-device integration",
      },
    });

    const b = await connect(firstMcp.url, "recovery-owner", "planner-b");
    const snapshot = jsonText(
      await b.client.callTool({
        name: "orchestration_snapshot",
        arguments: {},
      }),
    );

    expect(snapshot.recovery).toMatchObject({
      hasActiveWork: false,
      doNotCreateReplacementTask: true,
      hasPlannerCheckpoint: true,
      plannerConnected: true,
      recommendedAction: "resume_planner_checkpoint",
      orchestrationId: "orch_multi_device",
    });
    expect(snapshot.continuation).toMatchObject({
      plannerConnected: true,
      checkpoint: {
        revision: 1,
        status: "active",
        goal: "Finish multi-device integration",
        phase: "bridge tests",
        nextActions: [
          "run bridge targeted tests",
          "finish MCP remote submission tests",
        ],
      },
    });

    await b.client.callTool({
      name: "planner_checkpoint",
      arguments: {
        goal: "Finish multi-device integration",
        phase: "full verification",
        next_actions: ["run full gate"],
        orchestration_id: "orch_multi_device",
      },
    });
    await b.transport.close();

    await firstMcp.close();
    closers.pop();
    expect(continuation.summary().latestActive).toMatchObject({
      plannerConnected: false,
      checkpoint: {
        revision: 2,
        phase: "full verification",
      },
    });

    const secondStore = new PlannerContinuationStore({ file });
    const secondMcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl,
      plannerContinuation: secondStore,
    });
    closers.push(() => secondMcp.close());

    const c = await connect(secondMcp.url, "recovery-owner", "planner-c");
    closers.push(() => c.transport.close().catch(() => undefined));

    const restarted = jsonText(
      await c.client.callTool({
        name: "orchestration_snapshot",
        arguments: {},
      }),
    );
    expect(restarted.recovery).toMatchObject({
      hasActiveWork: false,
      hasPlannerCheckpoint: true,
      recommendedAction: "resume_planner_checkpoint",
    });
    expect(restarted.continuation.checkpoint).toMatchObject({
      revision: 2,
      phase: "full verification",
      nextActions: ["run full gate"],
    });

    const completed = jsonText(
      await c.client.callTool({
        name: "planner_checkpoint_complete",
        arguments: { summary: "Integration verified." },
      }),
    );
    expect(completed.checkpoint).toMatchObject({
      revision: 3,
      status: "completed",
      summary: "Integration verified.",
      nextActions: [],
    });

    const finalSnapshot = jsonText(
      await c.client.callTool({
        name: "orchestration_snapshot",
        arguments: {},
      }),
    );
    expect(finalSnapshot.recovery).toMatchObject({
      hasActiveWork: false,
      doNotCreateReplacementTask: false,
      hasPlannerCheckpoint: false,
      recommendedAction: "no_active_durable_work",
    });
  });
});
