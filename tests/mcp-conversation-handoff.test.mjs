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
  const client = new Client({ name, version: "1.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: { "x-owl-owner-id": ownerId },
    },
  });
  await client.connect(transport);
  return { client, transport };
}

describe("MCP Conversation Continuity", () => {
  it("hands one logical workstream from Chat A to Chat B without replacement work", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-conversation-handoff-"));
    roots.push(root);
    const file = path.join(root, "planner-continuation.json");
    const continuation = new PlannerContinuationStore({ file });
    const runtimeBaseUrl = await startRuntime();

    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl,
      plannerContinuation: continuation,
    });
    closers.push(() => mcp.close());

    const chatA = await connect(mcp.url, "chat-a", "chat-a");
    const opened = jsonText(
      await chatA.client.callTool({
        name: "workstream_open",
        arguments: {
          goal: "Finish OWL LAB 1.1 continuity",
          label: "OWL LAB",
          client_kind: "chatgpt",
        },
      }),
    );
    const workstreamId = opened.workstreamId;

    await chatA.client.callTool({
      name: "planner_checkpoint",
      arguments: {
        workstream_id: workstreamId,
        goal: "Finish OWL LAB 1.1 continuity",
        phase: "cross-chat E2E",
        summary: "Conversation handoff tools are implemented.",
        completed: ["handoff store", "handoff MCP surface"],
        next_actions: ["resume from Chat B", "run full gate"],
        task_ids: ["task_812"],
        decisions: ["Keep Runtime Task identity stable"],
        constraints: ["Runtime 1.0 stays frozen"],
        do_not_repeat: ["Do not create a replacement task"],
      },
    });

    const prepared = jsonText(
      await chatA.client.callTool({
        name: "conversation_handoff_prepare",
        arguments: {
          workstream_id: workstreamId,
          project: "OWL LAB",
          reason: "continuity_high",
          continuity_risk: "high",
        },
      }),
    );
    expect(prepared).toMatchObject({
      handoffReady: true,
      handoff: {
        status: "ready",
        project: "OWL LAB",
        sourceWorkstreamId: workstreamId,
        capsule: {
          taskIds: ["task_812"],
          decisions: ["Keep Runtime Task identity stable"],
          doNotRepeat: ["Do not create a replacement task"],
        },
      },
    });
    const handoffId = prepared.handoff.id;

    await chatA.transport.close();

    const chatB = await connect(mcp.url, "chat-b", "chat-b");
    closers.push(() => chatB.transport.close().catch(() => undefined));

    const latest = jsonText(
      await chatB.client.callTool({
        name: "conversation_handoff_latest",
        arguments: { project: "OWL LAB" },
      }),
    );
    expect(latest).toMatchObject({
      available: true,
      recommendedAction: "resume_existing_workstream",
      resumeWorkstreamId: workstreamId,
      handoff: {
        id: handoffId,
        status: "ready",
      },
    });

    expect(continuation.get("chat-b")?.workstream ?? null).toBeNull();

    const resumed = jsonText(
      await chatB.client.callTool({
        name: "workstream_open",
        arguments: {
          goal: latest.resumeGoal,
          label: "OWL LAB",
          client_kind: "chatgpt",
          resume_workstream_id: latest.resumeWorkstreamId,
        },
      }),
    );
    expect(resumed).toMatchObject({
      workstreamId,
      resumed: true,
      goal: "Finish OWL LAB 1.1 continuity",
    });

    const checkpoint = jsonText(
      await chatB.client.callTool({
        name: "planner_checkpoint_status",
        arguments: { workstream_id: workstreamId },
      }),
    );
    expect(checkpoint).toMatchObject({
      ownerId: workstreamId,
      checkpoint: {
        phase: "cross-chat E2E",
        taskIds: ["task_812"],
        decisions: ["Keep Runtime Task identity stable"],
        constraints: ["Runtime 1.0 stays frozen"],
      },
    });

    const consumed = jsonText(
      await chatB.client.callTool({
        name: "conversation_handoff_consume",
        arguments: {
          workstream_id: workstreamId,
          handoff_id: handoffId,
        },
      }),
    );
    expect(consumed).toMatchObject({
      alreadyConsumed: false,
      handoff: {
        id: handoffId,
        status: "consumed",
      },
    });

    const after = jsonText(
      await chatB.client.callTool({
        name: "conversation_handoff_latest",
        arguments: { project: "OWL LAB" },
      }),
    );
    expect(after).toMatchObject({
      available: false,
      handoff: null,
      recommendedAction: "none",
    });

    const restoredStore = new PlannerContinuationStore({ file });
    expect(restoredStore.getHandoff(handoffId)).toMatchObject({
      status: "consumed",
      sourceWorkstreamId: workstreamId,
    });
  });
});
