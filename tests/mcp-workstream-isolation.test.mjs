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
    const progressIngressEvents = [];
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl: runtime.baseUrl,
      fallbackOwnerId: "desktop-shared-fallback",
      plannerContinuation: continuation,
      onEvent(_level, message, meta) {
        if (message === "MCP interaction request" &&
            meta?.tool === "workstream_progress") {
          progressIngressEvents.push({ tool: meta.tool, phase: meta.phase });
        }
      },
    });
    closers.push(() => mcp.close());

    let client = new Client({ name: "shared-chat-transport", version: "0.1.0" });
    let transport = new StreamableHTTPClientTransport(new URL(mcp.url));
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

    let softReminders = 0;
    for (let index = 3; index < 12; index += 1) {
      const result = await client.callTool({ name: "runtime_info", arguments: { workstream_id: a } });
      expect(result.isError).not.toBe(true);
      const payload = jsonText(result);
      if (payload.owlProgressAdvisory) {
        softReminders += 1;
        expect(payload.owlProgressAdvisory).toMatchObject({
          type: "SOFT_PROGRESS_REMINDER",
          blocking: false,
          hardGateEnabled: false,
        });
      }
    }
    expect(softReminders).toBe(1);

    const extraRead = await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: a },
    });
    expect(extraRead.isError).not.toBe(true);
    expect(continuation.get(a).workstream.progressBoundary).toBeNull();
    expect(continuation.get(a).workstream.toolStepsSinceProgress).toBe(13);
    expect(continuation.get(a).workstream.progressBoundary).toBeNull();
    // Ordinary reads continue through the early advisory interval.
    expect(continuation.get(a).workstream.lastProgressAdvisoryAt).toBeTruthy();
    for (let step = 13; step < 48; step += 1) {
      const read = await client.callTool({
        name: "runtime_info", arguments: { workstream_id: a },
      });
      expect(read.isError).not.toBe(true);
    }
    expect(continuation.get(a).workstream.toolStepsSinceProgress).toBe(48);
    expect(continuation.get(a).workstream.progressBoundary).toBeNull();

    // A progress reminder is never a substitute for Runtime command security,
    // and 48+ steps must not deadlock the chat.
    const afterManySteps = jsonText(await client.callTool({
      name: "task_cancel",
      arguments: { workstream_id: a, task_id: "test-only" },
    }));
    expect(afterManySteps.code).not.toBe("PROGRESS_UPDATE_REQUIRED");
    expect(continuation.get(a).workstream.progressBoundary).toBeNull();

    // Simulate a pending gate persisted by an older MCP version.
    const pending = continuation.markProgressBoundary(a, {
      toolStepsSinceProgress: 48,
      silenceMs: 620000,
      retryTool: "task_cancel",
      userVisibleProgress: "Old blocker that was never shown to the user",
    }).workstream.progressBoundary;
    const lastAck = continuation.get(a).workstream.lastAcknowledgedProgressBoundary;
    const resume = jsonText(await client.callTool({
      name: "task_cancel",
      arguments: { workstream_id: a, task_id: "test-only" },
    }));
    expect(resume.code).not.toBe("PROGRESS_UPDATE_REQUIRED");
    const released = continuation.get(a).workstream;
    expect(released.progressBoundary).toBeNull();
    expect(released.lastReleasedProgressBoundary).toMatchObject({
      boundaryId: pending.boundaryId,
      reason: "nonblocking_progress_migration",
      acknowledged: false,
    });
    expect(released.lastAcknowledgedProgressBoundary).toEqual(lastAck);

    await transport.close();
    client = new Client({ name: "reconnected-chat", version: "0.1.0" });
    transport = new StreamableHTTPClientTransport(new URL(mcp.url));
    await client.connect(transport);
    const recovered = await client.callTool({
      name: "list_processes",
      arguments: { workstream_id: a },
    });
    expect(recovered.isError).not.toBe(true);
    expect(continuation.get(a).workstream.goal).toBe("Build Monitor");

    const progress = jsonText(await client.callTool({
      name: "workstream_progress",
      arguments: {
        workstream_id: a,
        completed: ["Previously executed Runtime checks"],
        current: "Continue original Monitor testing",
        next_actions: ["Validate original acceptance criteria"],
      },
    }));
    expect(progress.acknowledgedBoundaryId).toBeNull();
    expect(progress.durableExecution).toMatchObject({
      recommended: true,
      preferredTool: "task_submit",
    });
    expect(continuation.get(a).workstream.progressBoundary).toBeNull();
    expect(progressIngressEvents).toHaveLength(2);

    await client.callTool({
      name: "runtime_info",
      arguments: { workstream_id: a },
    });
    const infoCalls = runtime.observed.filter((item) => item.method === "info");
    expect(infoCalls.length).toBeGreaterThanOrEqual(49);
    expect(infoCalls.some((item) => item.sessionId === a)).toBe(true);
    expect(infoCalls.some((item) => item.sessionId === b)).toBe(true);

    const ownerA = continuation.get(a);
    const ownerB = continuation.get(b);
    expect(ownerA).toMatchObject({
      clientKind: "chatgpt",
      clientLabel: "Chat A",
      workstream: {
        goal: "Build Monitor",
        toolStepsSinceProgress: 1,
        totalToolSteps: expect.any(Number),
      },
    });
    expect(ownerA.workstream.progressEvents.at(-1)).toMatchObject({
      current: "Continue original Monitor testing",
      nextActions: ["Validate original acceptance criteria"],
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
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: { headers: { "x-owl-owner-id": ownerId } },
    });
    await client.connect(transport);
    closers.push(() => transport.close().catch(() => undefined));

    for (let index = 0; index < 48; index += 1) {
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
        toolStepsSinceProgress: 48,
        totalToolSteps: 48,
      },
    });

    const continued = jsonText(await client.callTool({
      name: "task_cancel",
      arguments: { task_id: "test-only" },
    }));
    expect(continued.code).not.toBe("PROGRESS_UPDATE_REQUIRED");
    expect(continuation.get(actualOwnerId).workstream.progressBoundary).toBeNull();

    continuation.progressWorkstream(actualOwnerId, {
      current: "No new OWL work yet",
      status: "active",
    },new Date(Date.now()-60_000).toISOString());
    const afterIdleSilence = await client.callTool({
      name: "runtime_info", arguments: {},
    });
    expect(afterIdleSilence.isError).not.toBe(true);
    expect(continuation.get(actualOwnerId).workstream.toolStepsSinceProgress).toBe(1);

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

    for (let index = 0; index < 48; index += 1) {
      const result = await client.callTool({
        name: "runtime_info",
        arguments: { workstream_id: ownerId },
      });
      expect(result.isError).not.toBe(true);
    }

    const continued = jsonText(await client.callTool({
      name: "task_cancel",
      arguments: { workstream_id: ownerId, task_id: "test-only" },
    }));
    expect(continued.code).not.toBe("PROGRESS_UPDATE_REQUIRED");
    expect(continuation.get(ownerId).workstream.progressBoundary).toBeNull();
    const retried = await client.callTool({
      name: "runtime_info", arguments: { workstream_id: ownerId },
    });
    expect(retried.isError).not.toBe(true);
    expect(continuation.get(ownerId).workstream.toolStepsSinceProgress).toBeGreaterThan(48);
  }, 30_000);
});
