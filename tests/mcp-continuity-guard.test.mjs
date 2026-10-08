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
    const result =
      rpc.method === "tasks.list"
        ? []
        : rpc.method === "info"
          ? { apiVersion: "0.1", runtimeVersion: "test-runtime" }
          : {};
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

describe("MCP Conversation Continuity guard", () => {
  it("does not auto-create a handoff from HIGH context risk", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-continuity-guard-"));
    roots.push(root);
    const continuation = new PlannerContinuationStore({
      file: path.join(root, "planner-continuation.json"),
    });
    const source = continuation.openWorkstream({
      goal: "Keep long OWL work recoverable",
      label: "OWL LAB",
      clientKind: "chatgpt",
    });
    continuation.checkpoint(source.ownerId, {
      goal: "Keep long OWL work recoverable",
      phase: "long session",
      nextActions: ["continue existing task"],
      taskIds: ["task_812"],
    });
    const runtimeBaseUrl = await startRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl,
      plannerContinuation: continuation,
    });
    closers.push(() => mcp.close());

    const client = new Client({ name: "continuity-guard", version: "1.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: {
        headers: { "x-owl-owner-id": "new-chat-owner" },
      },
    });
    await client.connect(transport);
    closers.push(() => transport.close().catch(() => undefined));

    const resumed = jsonText(
      await client.callTool({
        name: "workstream_open",
        arguments: {
          goal: "Keep long OWL work recoverable",
          label: "OWL LAB",
          client_kind: "chatgpt",
          resume_workstream_id: source.ownerId,
        },
      }),
    );
    expect(resumed).toMatchObject({
      workstreamId: source.ownerId,
      resumed: true,
    });

    continuation.recordConversationTraffic(source.ownerId, {
      tool: "large_result",
      requestChars: 100_000,
      responseChars: 3_000_000,
      requestDigest: "request-large",
      responseDigest: "response-large",
    });
    for (let index = 0; index < 12; index += 1) {
      continuation.recordWorkstreamToolStep(source.ownerId, {
        tool: "read_file",
        outcome: "success",
        durationMs: 10,
      });
    }
    expect(continuation.continuityStatus(source.ownerId)).toMatchObject({
      risk: "high",
      handoffReady: false,
      state: "handoff_recommended",
    });

    const readyBeforeBoundary = continuation.latestHandoff();
    expect(readyBeforeBoundary).toBeNull();

    const blocked = await client.callTool({
      name: "task_list",
      arguments: { workstream_id: source.ownerId },
    });
    expect(blocked.isError).toBe(true);

    expect(continuation.latestHandoff()).toBeNull();

    const payload = jsonText(blocked);
    expect(payload).toMatchObject({
      code: "PROGRESS_UPDATE_REQUIRED",
      progressBoundary: {
        pending: true,
        acknowledgementRequired: true,
      },
    });
    expect(payload.progressBoundary).not.toHaveProperty(
      "conversationContinuity",
    );
    expect(payload.progressBoundary.userVisibleProgress).not.toContain(
      "Planner Handoff",
    );

    continuation.prepareHandoff(source.ownerId, {
      reason: "continuity_high",
      continuityRisk: "high",
    });
    const withHandoff = jsonText(await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: source.ownerId },
    }));
    expect(withHandoff.code).toBe("PROGRESS_UPDATE_REQUIRED");
    expect(withHandoff.progressBoundary.boundaryId).toBe(
      payload.progressBoundary.boundaryId,
    );
    expect(withHandoff.progressBoundary.userVisibleProgress).toBe(
      payload.progressBoundary.userVisibleProgress,
    );
    expect(withHandoff.progressBoundary.continuityNotice).toContain(
      "Planner Handoff",
    );
    expect(withHandoff.progressBoundary.conversationContinuity).toMatchObject({
      handoffReady: true,
      risk: "high",
    });

    const missingCurrent = jsonText(await client.callTool({
      name: "workstream_progress",
      arguments: { workstream_id: source.ownerId },
    }));
    expect(missingCurrent.code).toBe("PROGRESS_CURRENT_REQUIRED");

    const confirmed = jsonText(await client.callTool({
      name: "workstream_progress",
      arguments: {
        workstream_id: source.ownerId,
        progress_boundary_id: payload.progressBoundary.boundaryId,
        user_visible_progress: withHandoff.progressBoundary.userVisibleProgress,
      },
    }));
    expect(confirmed.current).toBe(payload.progressBoundary.current);
    expect(confirmed.acknowledgedBoundaryId).toBe(
      payload.progressBoundary.boundaryId,
    );
    expect(continuation.get(source.ownerId).workstream.progressBoundary).toBeNull();
  });
});
