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
  const methods = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = body ? JSON.parse(body) : {};
    methods.push(rpc.method);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      apiVersion: "0.1",
      result:
        rpc.method === "capabilities.get"
          ? { runtimeVersion: "test-runtime", goal: rpc.params?.goal ?? "" }
          : {},
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return {
    methods,
    baseUrl: "http://127.0.0.1:" + server.address().port,
  };
}

async function connect(url, ownerId, name) {
  const client = new Client({ name, version: "1.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { "x-owl-owner-id": ownerId } },
  });
  await client.connect(transport);
  closers.push(() => transport.close().catch(() => undefined));
  return client;
}

describe("MCP continuity compatibility skill", () => {
  it("resumes and consumes a Planner Handoff through cached skill_run surface", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-continuity-compat-"));
    roots.push(root);
    const continuation = new PlannerContinuationStore({
      file: path.join(root, "planner-continuation.json"),
    });
    const runtime = await startRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      fallbackOwnerId: "desktop-global",
      plannerContinuation: continuation,
    });
    closers.push(() => mcp.close());

    const chatA = await connect(mcp.url, "chat-a", "chat-a");
    const opened = jsonText(await chatA.callTool({
      name: "workstream_open",
      arguments: {
        goal: "Finish OWL LAB continuity compatibility",
        label: "OWL LAB",
        client_kind: "chatgpt",
      },
    }));
    const workstreamId = opened.workstreamId;

    await chatA.callTool({
      name: "planner_checkpoint",
      arguments: {
        workstream_id: workstreamId,
        goal: "Finish OWL LAB continuity compatibility",
        phase: "cached catalog E2E",
        summary: "Dedicated handoff tools exist, but the planner catalog may be stale.",
        next_actions: ["resume through skill_run"],
        task_ids: ["task_cached_1"],
      },
    });
    const prepared = jsonText(await chatA.callTool({
      name: "conversation_handoff_prepare",
      arguments: {
        workstream_id: workstreamId,
        project: "OWL LAB",
        reason: "manual",
      },
    }));
    const handoffId = prepared.handoff.id;

    const chatB = await connect(mcp.url, "chat-b", "chat-b");
    const capabilities = jsonText(await chatB.callTool({
      name: "get_capabilities",
      arguments: { goal: "continue OWL LAB" },
    }));
    expect(capabilities.conversationContinuity).toMatchObject({
      readyHandoffCount: 1,
      latestReadyHandoff: {
        id: handoffId,
        project: "OWL LAB",
        sourceWorkstreamId: workstreamId,
      },
      resumeVia: {
        tool: "skill_run",
        skill: "owl.continuity.resume",
        args: { handoff_id: handoffId },
      },
    });

    const stateBeforeResume = continuation.read();
    const transientOwner = Object.values(stateBeforeResume.owners).find(
      (owner) =>
        owner.ownerId !== workstreamId &&
        owner.workstream?.implicit === true &&
        owner.workstream?.status === "active",
    );
    expect(transientOwner?.ownerId).toMatch(/^owl-owner:/);

    const resumed = jsonText(await chatB.callTool({
      name: "skill_run",
      arguments: {
        skill: "owl.continuity.resume",
        args: { handoff_id: handoffId },
      },
    }));
    expect(resumed).toMatchObject({
      compatibilityVersion: 1,
      operation: "resume",
      available: true,
      resumed: true,
      workstreamId,
      supersededWorkstreamId: transientOwner.ownerId,
      handoff: { id: handoffId, status: "consumed" },
      capsule: {
        goal: "Finish OWL LAB continuity compatibility",
        phase: "cached catalog E2E",
        taskIds: ["task_cached_1"],
      },
    });

    expect(continuation.get(transientOwner.ownerId).workstream.status).toBe("completed");
    expect(continuation.get(workstreamId)).toMatchObject({
      clientKind: "chatgpt",
      workstream: { status: "active" },
    });
    expect(continuation.getHandoff(handoffId)).toMatchObject({
      status: "consumed",
      sourceWorkstreamId: workstreamId,
    });
    expect(runtime.methods).not.toContain("skill.run");
  }, 30_000);
});
