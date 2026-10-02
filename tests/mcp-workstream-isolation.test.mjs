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
  const observed = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = body ? JSON.parse(body) : {};
    observed.push({
      method: rpc.method,
      sessionId: req.headers["x-owl-session-id"],
    });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      apiVersion: "0.1",
      result:
        rpc.method === "info"
          ? { apiVersion: "0.1", runtimeVersion: "test-runtime" }
          : {},
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return {
    observed,
    baseUrl: "http://127.0.0.1:" + server.address().port,
  };
}

describe("MCP workstream isolation", () => {
  it("keeps two logical workstreams isolated even on the same MCP transport", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-workstream-isolation-"));
    roots.push(root);
    const continuation = new PlannerContinuationStore({
      file: path.join(root, "planner-continuation.json"),
    });
    const runtime = await startRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      fallbackOwnerId: "desktop-shared-fallback",
      plannerContinuation: continuation,
    });
    closers.push(() => mcp.close());

    const client = new Client({ name: "shared-chat-transport", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url));
    await client.connect(transport);
    closers.push(() => transport.close().catch(() => undefined));

    const openedA = jsonText(await client.callTool({
      name: "workstream_open",
      arguments: {
        goal: "Build Monitor",
        label: "Chat A",
        client_kind: "chatgpt",
      },
    }));
    const a = openedA.workstreamId;
    expect(a).toMatch(/^owl-workstream:/);

    await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: a },
    });
    await client.callTool({
      name: "workstream_progress",
      arguments: {
        workstream_id: a,
        completed: ["Monitor model"],
        current: "Running tests",
        next_actions: ["Commit"],
      },
    });

    const openedB = jsonText(await client.callTool({
      name: "workstream_open",
      arguments: {
        goal: "Nightly regression",
        label: "Night Worker",
        client_kind: "worker",
      },
    }));
    const b = openedB.workstreamId;
    expect(b).toMatch(/^owl-workstream:/);
    expect(b).not.toBe(a);

    await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: b },
    });
    await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: a },
    });
    await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: a },
    });
    await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: a },
    });

    const blocked = await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: a },
    });
    expect(blocked.isError).toBe(true);
    const boundary = jsonText(blocked);
    expect(boundary).toMatchObject({
      code: "PROGRESS_UPDATE_REQUIRED",
      progressBoundary: {
        workstreamId: a,
        pending: true,
        acknowledgementRequired: true,
        toolStepsSinceProgress: 3,
        recommendedUpdateIntervalMs: 10000,
        recommendedMaxToolStepsWithoutUpdate: 3,
        durableExecution: {
          recommended: true,
          preferredTool: "task_submit",
        },
      },
    });

    const stillBlocked = jsonText(await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: a },
    }));
    expect(stillBlocked).toMatchObject({
      code: "PROGRESS_UPDATE_REQUIRED",
      progressBoundary: {
        boundaryId: boundary.progressBoundary.boundaryId,
        pending: true,
      },
    });
    expect(continuation.get(a).workstream.toolStepsSinceProgress).toBe(3);

    const progress = jsonText(await client.callTool({
      name: "workstream_progress",
      arguments: {
        workstream_id: a,
        completed: ["Three Runtime checks"],
        current: "Reporting progress before more tool work",
        next_actions: ["Continue validation"],
        progress_boundary_id: boundary.progressBoundary.boundaryId,
        user_visible_progress: boundary.progressBoundary.userVisibleProgress,
      },
    }));
    expect(progress.userVisibleProgress).toBe(
      boundary.progressBoundary.userVisibleProgress,
    );
    expect(progress.acknowledgedBoundaryId).toBe(
      boundary.progressBoundary.boundaryId,
    );
    expect(progress.durableExecution).toMatchObject({
      recommended: true,
      preferredTool: "task_submit",
    });

    await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: a },
    });

    const infoCalls = runtime.observed.filter((item) => item.method === "info");
    expect(infoCalls.map((item) => item.sessionId)).toEqual([
      a,
      b,
      a,
      a,
      a,
      a,
    ]);

    const ownerA = continuation.get(a);
    const ownerB = continuation.get(b);
    expect(ownerA).toMatchObject({
      clientKind: "chatgpt",
      clientLabel: "Chat A",
      workstream: {
        goal: "Build Monitor",
        toolStepsSinceProgress: 1,
        totalToolSteps: 5,
      },
    });
    expect(ownerA.workstream.progressEvents.at(-1)).toMatchObject({
      current: "Reporting progress before more tool work",
      nextActions: ["Continue validation"],
    });
    expect(ownerB).toMatchObject({
      clientKind: "worker",
      clientLabel: "Night Worker",
      workstream: {
        goal: "Nightly regression",
        toolStepsSinceProgress: 1,
      },
    });

    const completedA = jsonText(await client.callTool({
      name: "workstream_complete",
      arguments: {
        workstream_id: a,
        summary: "Monitor finished.",
      },
    }));
    expect(completedA).toMatchObject({
      workstreamId: a,
      status: "completed",
      summary: "Monitor finished.",
    });
    expect(continuation.get(a).workstream.status).toBe("completed");
    expect(continuation.get(b).workstream.status).toBe("active");
  }, 30_000);

  it("auto-creates an implicit workstream for a stable owner and enforces progress", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-implicit-workstream-"));
    roots.push(root);
    const continuation = new PlannerContinuationStore({
      file: path.join(root, "planner-continuation.json"),
    });
    const runtime = await startRuntime();
    const events = [];
    const ownerId = "owl-owner:implicit-test";
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      fallbackOwnerId: ownerId,
      plannerContinuation: continuation,
      onEvent(level, message, meta) {
        events.push({ level, message, meta });
      },
    });
    closers.push(() => mcp.close());

    const client = new Client({
      name: "implicit-owner-client",
      version: "0.1.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url));
    await client.connect(transport);
    closers.push(() => transport.close().catch(() => undefined));

    for (let index = 0; index < 3; index += 1) {
      const result = await client.callTool({
        name: "runtime_info",
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
    }

    const firstInteraction = events.find(
      (event) =>
        event.message === "MCP interaction request" &&
        event.meta?.tool === "runtime_info",
    );
    const actualOwnerId = firstInteraction?.meta?.runtimeSessionId;
    expect(actualOwnerId).toMatch(/^owl-owner:/);

    const owner = continuation.get(actualOwnerId);
    expect(owner).toMatchObject({
      ownerId: actualOwnerId,
      workstream: {
        workstreamId: actualOwnerId,
        implicit: true,
        status: "active",
        toolStepsSinceProgress: 3,
        totalToolSteps: 3,
      },
    });

    const blocked = await client.callTool({
      name: "runtime_info",
      arguments: {},
    });
    expect(blocked.isError).toBe(true);
    const boundary = jsonText(blocked);
    expect(boundary).toMatchObject({
      code: "PROGRESS_UPDATE_REQUIRED",
      progressBoundary: {
        workstreamId: actualOwnerId,
        toolStepsSinceProgress: 3,
        recommendedUpdateIntervalMs: 10000,
        boundaryRecorded: false,
        acknowledgementRequired: true,
        pending: true,
        retryTool: "runtime_info",
      },
    });
    expect(boundary.progressBoundary.userVisibleProgress).toContain(
      "Now: pausing to report progress",
    );

    continuation.progressWorkstream(
      actualOwnerId,
      {
        current: "No new OWL work yet",
        status: "active",
        progressBoundaryId: boundary.progressBoundary.boundaryId,
        userVisibleProgress: boundary.progressBoundary.userVisibleProgress,
      },
      new Date(Date.now() - 60_000).toISOString(),
    );
    expect(continuation.get(actualOwnerId).workstream).toMatchObject({
      toolStepsSinceProgress: 0,
    });

    const afterIdleSilence = await client.callTool({
      name: "runtime_info",
      arguments: {},
    });
    expect(afterIdleSilence.isError).not.toBe(true);
    expect(continuation.get(actualOwnerId).workstream).toMatchObject({
      toolStepsSinceProgress: 1,
      totalToolSteps: 4,
    });

    const interactionRequests = events.filter(
      (event) =>
        event.message === "MCP interaction request" &&
        event.meta?.tool === "runtime_info",
    );
    expect(interactionRequests.length).toBeGreaterThanOrEqual(5);
    expect(
      interactionRequests.every(
        (event) => event.meta?.workstreamId === actualOwnerId,
      ),
    ).toBe(true);
  }, 30_000);

  it("keeps pre-v2 workstreams on a backward-compatible soft progress boundary", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-legacy-progress-"));
    roots.push(root);
    const continuation = new PlannerContinuationStore({
      file: path.join(root, "planner-continuation.json"),
    });
    const legacy = continuation.openWorkstream({
      goal: "Legacy active chat",
      clientKind: "chatgpt",
      label: "Legacy Chat",
    });
    const ownerId = legacy.ownerId;
    const state = continuation.read();
    delete state.owners[ownerId].workstream.progressAckProtocol;
    continuation.write(state);

    const runtime = await startRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      fallbackOwnerId: "desktop-legacy-fallback",
      plannerContinuation: continuation,
    });
    closers.push(() => mcp.close());

    const client = new Client({ name: "legacy-chat", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url));
    await client.connect(transport);
    closers.push(() => transport.close().catch(() => undefined));

    for (let index = 0; index < 3; index += 1) {
      const result = await client.callTool({
        name: "runtime_info",
        arguments: { workstream_id: ownerId },
      });
      expect(result.isError).not.toBe(true);
    }

    const blocked = jsonText(await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: ownerId },
    }));
    expect(blocked).toMatchObject({
      code: "PROGRESS_UPDATE_REQUIRED",
      progressBoundary: {
        protocol: "legacy_soft",
        boundaryRecorded: true,
        acknowledgementRequired: false,
      },
    });

    const retried = await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: ownerId },
    });
    expect(retried.isError).not.toBe(true);
    expect(continuation.get(ownerId).workstream).toMatchObject({
      toolStepsSinceProgress: 1,
      progressBoundary: null,
    });
  }, 30_000);
});
