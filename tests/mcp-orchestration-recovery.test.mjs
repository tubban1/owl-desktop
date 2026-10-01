import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
import { AgentInboxStore } from "../electron/services/agent-inbox-store.mjs";

const closers = [];
const scratch = path.join(
  os.tmpdir(),
  "owl-orchestration-recovery-" + process.pid + "-" + Date.now(),
);

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
  await fs.rm(scratch, { recursive: true, force: true });
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
  const tasks = [
    {
      schemaVersion: 1,
      id: "task_release_tests",
      label: "Release tests",
      status: "running",
      ownerSessionId: "owl-owner:recovery-owner",
      orchestration: {
        schemaVersion: 1,
        orchestrationId: "orch_release",
        label: "OWL LAB release",
        parentTaskId: null,
      },
      createdAt: "2026-10-01T20:00:00.000Z",
      updatedAt: "2026-10-01T20:02:00.000Z",
      progress: {
        schemaVersion: 1,
        revision: 7,
        phase: "executing",
        terminal: false,
        counts: {
          total: 4,
          pending: 1,
          running: 1,
          waitingApproval: 0,
          succeeded: 2,
          failed: 0,
          needsReview: 0,
        },
        activeSteps: ["tests"],
        lastMeaningfulAt: "2026-10-01T20:01:58.000Z",
        message: "Running Runtime verification matrix.",
        lastEvent: {
          at: "2026-10-01T20:01:58.000Z",
          type: "step_started",
          stepId: "tests",
          message: "Started release tests.",
        },
      },
      verificationCounts: {
        required: 2,
        receipts: 1,
        verified: 1,
        failed: 0,
        uncertain: 0,
        missing: 1,
      },
      counts: {
        total: 4,
        pending: 1,
        running: 1,
        waitingApproval: 0,
        succeeded: 2,
        failed: 0,
        needsReview: 0,
      },
      staging: {
        artifactCount: 0,
        committedArtifactCount: 0,
        legacyUncommittedArtifactCount: 0,
        internalPathsExposed: false,
      },
    },
    {
      schemaVersion: 1,
      id: "task_terminal_review",
      label: "Old terminal review",
      status: "needs_review",
      ownerSessionId: "owl-owner:historical-owner",
      orchestration: null,
      createdAt: "2026-10-01T19:40:00.000Z",
      updatedAt: "2026-10-01T20:03:00.000Z",
      progress: {
        schemaVersion: 1,
        revision: 12,
        phase: "blocked",
        terminal: true,
        counts: {
          total: 1,
          pending: 0,
          running: 0,
          waitingApproval: 0,
          succeeded: 0,
          failed: 0,
          needsReview: 1,
        },
        activeSteps: [],
        lastMeaningfulAt: "2026-10-01T20:03:00.000Z",
        message: "Terminal review required.",
      },
      verificationCounts: {
        required: 1,
        receipts: 1,
        verified: 0,
        failed: 0,
        uncertain: 1,
        missing: 0,
      },
    },
    {
      schemaVersion: 1,
      id: "task_release_docs",
      label: "Release docs",
      status: "completed",
      ownerSessionId: "owl-owner:another-owner",
      orchestration: {
        schemaVersion: 1,
        orchestrationId: "orch_release",
        label: "OWL LAB release",
        parentTaskId: "task_release_tests",
      },
      createdAt: "2026-10-01T19:55:00.000Z",
      updatedAt: "2026-10-01T20:00:30.000Z",
      progress: {
        schemaVersion: 1,
        revision: 9,
        phase: "completed",
        terminal: true,
        counts: {
          total: 2,
          pending: 0,
          running: 0,
          waitingApproval: 0,
          succeeded: 2,
          failed: 0,
          needsReview: 0,
        },
        lastMeaningfulAt: "2026-10-01T20:00:30.000Z",
        message: "Task completed.",
      },
      verificationCounts: {
        required: 1,
        receipts: 1,
        verified: 1,
        failed: 0,
        uncertain: 0,
        missing: 0,
      },
    },
  ];

  const detail = {
    ...tasks[0],
    steps: [
      {
        id: "plan",
        action: "runtime.info",
        state: "succeeded",
        requiresVerification: false,
      },
      {
        id: "tests",
        action: "shell.exec",
        state: "running",
        requiresVerification: true,
        verification: null,
      },
      {
        id: "publish",
        action: "git.commit",
        state: "pending",
        requiresVerification: true,
        verification: null,
      },
    ],
    events: [
      {
        at: "2026-10-01T20:01:58.000Z",
        type: "step_started",
        stepId: "tests",
        message: "Started release tests.",
      },
    ],
  };

  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = body ? JSON.parse(body) : {};
    let result;
    if (rpc.method === "tasks.list") result = tasks;
    else if (rpc.method === "tasks.get") result = detail;
    else if (rpc.method === "info") {
      result = { apiVersion: "0.1", runtimeVersion: "test-runtime" };
    } else {
      result = {};
    }
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

describe("OWL orchestration recovery snapshot", () => {
  it("recovers active durable work after a new MCP transport connects", async () => {
    await fs.mkdir(scratch, { recursive: true });
    const inbox = new AgentInboxStore({
      file: path.join(scratch, "agent-inbox.json"),
    });
    inbox.create({
      type: "skill.repair",
      producer: "runtime",
      priority: "high",
      subject: { kind: "skill_candidate", id: "candidate_1" },
      reasonCode: "VALIDATION_FAILED",
      errorCodes: ["USER_SKILL_PRIMITIVE_ABI_UNSUPPORTED"],
      contextRefs: [],
      allowedActions: ["inspect", "revise"],
      requiresUserConfirmation: true,
    });

    const runtimeBaseUrl = await startRuntime();
    const mcp = await startOwlMcpHttpServer({
      port: 0,
      runtimeBaseUrl,
      agentInbox: inbox,
    });
    closers.push(() => mcp.close());

    const client = new Client({
      name: "recovery-test",
      version: "0.1.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
      requestInit: {
        headers: { "x-owl-owner-id": "recovery-owner" },
      },
    });
    await client.connect(transport);
    closers.push(() => transport.close().catch(() => undefined));

    const result = await client.callTool({
      name: "orchestration_snapshot",
      arguments: { include_agent_requests: true },
    });
    expect(result.isError).not.toBe(true);
    const snapshot = jsonText(result);

    expect(snapshot.recovery).toMatchObject({
      hasActiveWork: true,
      doNotCreateReplacementTask: true,
      ambiguousActiveWork: false,
      recommendedAction: "continue_existing_task",
      focusTaskId: "task_release_tests",
      orchestrationId: "orch_release",
    });
    expect(snapshot.focus).toMatchObject({
      taskId: "task_release_tests",
      status: "running",
      verificationCounts: {
        required: 2,
        verified: 1,
        missing: 1,
      },
    });
    expect(snapshot.focus.progress.message).toContain("verification matrix");
    expect(snapshot.focusDetail).toMatchObject({
      activeSteps: [
        {
          id: "tests",
          action: "shell.exec",
          state: "running",
          verificationStatus: "missing",
        },
      ],
      nextStep: {
        id: "publish",
        action: "git.commit",
        state: "pending",
      },
    });
    expect(snapshot.workset).toMatchObject({
      orchestrationId: "orch_release",
      label: "OWL LAB release",
      taskCount: 2,
    });
    expect(snapshot.workset.tasks.map((task) => task.taskId)).toEqual([
      "task_release_tests",
      "task_release_docs",
    ]);
    expect(snapshot.openAgentRequests).toHaveLength(1);
    expect(snapshot.openAgentRequests[0]).toMatchObject({
      type: "skill.repair",
      priority: "high",
      status: "pending",
      requiresUserConfirmation: true,
    });

    expect(
      snapshot.ungroupedActive.some(
        (task) => task.taskId === "task_terminal_review",
      ),
    ).toBe(false);

    const activeListResult = await client.callTool({
      name: "task_list",
      arguments: { active_only: true },
    });
    expect(activeListResult.isError).not.toBe(true);
    const activeTasks = jsonText(activeListResult);
    expect(activeTasks.map((task) => task.id)).toEqual([
      "task_release_tests",
    ]);
  });
});
