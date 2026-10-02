#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";
import { buildMonitorModel } from "../src/monitor/monitorModel.ts";
import { buildOrchestrationModel } from "../src/monitor/orchestrationModel.ts";

const runtimeSourceDir = process.env.OWL_RUNTIME_SOURCE_DIR?.trim();
if (!runtimeSourceDir) {
  throw new Error(
    "OWL_RUNTIME_SOURCE_DIR is required and must point at the Runtime source checkpoint under test.",
  );
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Could not allocate an isolated Runtime port.");
  return port;
}

async function waitForRuntime(baseUrl, child, output) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        "Isolated Runtime exited before readiness.\n" + output.join(""),
      );
    }
    try {
      const response = await fetch(baseUrl + "/health");
      if (response.ok) return;
    } catch {
      // startup not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    "Timed out waiting for isolated Runtime readiness.\n" + output.join(""),
  );
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 4_000)),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "owl-monitor-orch-"));
const stateRoot = path.join(scratch, "state");
const sourcePath = path.join(scratch, "source.txt");
await fs.writeFile(sourcePath, "monitor orchestration product live\n", "utf8");
const port = await freePort();
const baseUrl = "http://127.0.0.1:" + String(port);
const runtimeOutput = [];

const runtime = spawn("npm", ["run", "start:source"], {
  cwd: runtimeSourceDir,
  env: {
    ...process.env,
    PORT: String(port),
    AGENTOS_STATE_ROOT: stateRoot,
    ALLOWED_DIRECTORIES: scratch,
    ALLOW_WRITE: "true",
    ALLOW_DELETE: "true",
    ALLOW_SHELL: "false",
    ALLOW_GIT_PUSH: "false",
    OWL_APPROVAL_MODE: "compat",
    OWL_RUNTIME_ACCESS_MODE: "compat",
    OWL_RUNTIME_REQUIRE_SIGNED_LEASE: "false",
    TASK_STAGING_EXPOSE_TO_FS: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
runtime.stdout.on("data", (chunk) => runtimeOutput.push(String(chunk)));
runtime.stderr.on("data", (chunk) => runtimeOutput.push(String(chunk)));

try {
  await waitForRuntime(baseUrl, runtime, runtimeOutput);

  const client = new RuntimeHttpClient({
    baseUrl,
    sessionId: "owl-desktop:monitor-orchestration-product-live",
  });
  const info = await client.info();
  const runtimeSha = execFileSync(
    "git",
    ["-C", runtimeSourceDir, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();

  const orchestrationId = "orch_monitor_product_live";
  const orchestrationLabel = "Monitor product-live orchestration";

  const taskA = await client.createTask({
    label: "Prepare release evidence",
    steps: [
      {
        id: "read",
        action: "fs.read",
        args: { path: sourcePath },
      },
    ],
    orchestration: {
      orchestrationId,
      label: orchestrationLabel,
    },
  });
  const runA = await client.runTask(taskA.id, {
    maxWaves: 5,
    timeBudgetMs: 30_000,
    timeoutMs: 40_000,
  });
  assert.equal(runA.status, "completed");

  const taskB = await client.createTask({
    label: "Validate release dependency",
    steps: [
      {
        id: "inspect",
        action: "fs.read",
        args: { path: sourcePath },
      },
      {
        id: "confirm",
        action: "fs.read",
        args: { path: sourcePath },
        dependsOn: ["inspect"],
      },
    ],
    orchestration: {
      orchestrationId,
      label: orchestrationLabel,
      parentTaskId: taskA.id,
    },
  });

  const unrelated = await client.createTask({
    label: "Unrelated work",
    steps: [
      {
        id: "read",
        action: "fs.read",
        args: { path: sourcePath },
      },
    ],
    orchestration: {
      orchestrationId: "orch_unrelated_product_live",
      label: "Different goal",
    },
  });

  const taskRows = await client.tasks();
  const detailB = await client.getTask(taskB.id, false);
  assert.equal(
    taskRows.find((task) => task.id === taskA.id)?.orchestration?.orchestrationId,
    orchestrationId,
  );
  assert.equal(
    taskRows.find((task) => task.id === taskB.id)?.orchestration?.parentTaskId,
    taskA.id,
  );

  const snapshot = {
    mode: "live",
    checkedAt: new Date().toISOString(),
    latencyMs: 0,
    info,
    runtimeAccess: null,
    health: {},
    tasks: taskRows,
    approvals: [],
    processes: [],
    diagnostics: {},
    error: null,
    metrics: {
      tasks: taskRows.length,
      approvals: 0,
      processes: 0,
    },
    mcp: {
      status: "stopped",
      url: "",
      error: null,
      sessionCount: 0,
      sessions: [],
    },
    host: null,
    tunnel: {
      state: "stopped",
      pid: null,
      mcpUrl: "",
      error: null,
      secretStorage: "none",
    },
    cloud: {
      status: "stopped",
      deviceId: null,
      lastHeartbeatAt: null,
      lastPollAt: null,
      lastError: null,
      commandCounts: {
        processing: 0,
        accepted: 0,
        rejected: 0,
        uncertain: 0,
      },
      outboxPending: 0,
      commands: [],
    },
    agentInbox: {
      pending: 0,
      claimed: 0,
      highestPriority: null,
      byType: {},
    },
    runtimeEvents: {
      version: 1,
      status: "stopped",
      supported: true,
      running: false,
      pollIntervalMs: 1000,
      lastPollAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      acceptedEvents: 0,
      acceptedPages: 0,
      retention: null,
      reconciliation: null,
      consumer: {
        lastSequence: null,
        lastCursor: null,
      },
    },
    accounts: [],
    activity: [],
  };

  const system = buildMonitorModel({
    snapshot,
    agentRequests: [],
    skillSnapshot: null,
    activity: [],
  });
  const model = buildOrchestrationModel({
    snapshot,
    agentRequests: [],
    skillSnapshot: null,
    activity: [],
    system,
    selectedTaskId: taskB.id,
    taskDetail: detailB,
  });

  assert.equal(model.focusTaskId, taskB.id);
  assert.equal(model.headline.label, orchestrationLabel);
  assert.equal(model.workset?.orchestrationId, orchestrationId);
  assert.equal(model.workset?.taskCount, 2);
  assert.deepEqual(
    new Set(model.workset?.tasks.map((task) => task.id)),
    new Set([taskA.id, taskB.id]),
  );
  assert.equal(
    model.workset?.tasks.some((task) => task.id === unrelated.id),
    false,
  );
  assert.equal(model.headline.completedSteps, 1);
  assert.equal(model.headline.totalSteps, 3);
  assert.equal(model.headline.overallPercent, 33);
  assert.deepEqual(model.graph.edges, [
    { from: "inspect", to: "confirm" },
  ]);
  assert.equal(model.inspector?.id, taskB.id);
  assert.equal(model.inspector?.verification.required, 0);

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtimeSha,
        runtimeVersion: info.runtimeVersion,
        runtimeBaseUrl: baseUrl,
        desktopRuntimeHttpClient: true,
        publicTaskOrchestration: true,
        worksetTaskCount: model.workset?.taskCount,
        unrelatedTaskExcluded: true,
        overallPercent: model.headline.overallPercent,
        canonicalTaskGraph: true,
        selectedTaskInspector: true,
      },
      null,
      2,
    ),
  );
} finally {
  await stopChild(runtime);
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
}
