#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { CloudHttpClient } from "../electron/services/cloud-http-client.mjs";
import { CloudMcpCallConsumer } from "../connection-host/cloud-mcp-call-consumer.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.resolve(root, "../owl-runtime");
const workerPath = path.join(
  root,
  "scripts",
  "fault-matrix",
  "cloud-mcp-fault-worker.mjs",
);
const evidenceDir = path.join(
  root,
  "release",
  "acceptance",
  "cloud-mcp-fault-matrix-f1-f5",
);
const evidenceFile = path.join(evidenceDir, "fault-matrix-f1-f5.json");

function assert(condition, message, details) {
  if (condition) return;
  const suffix =
    details === undefined ? "" : "\n" + JSON.stringify(details, null, 2);
  throw new Error(message + suffix);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function allocatePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an isolated test port."));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function listenerPid(port) {
  try {
    const { stdout } = await execFileAsync(
      "/usr/sbin/lsof",
      ["-nP", "-tiTCP:" + String(port), "-sTCP:LISTEN"],
      { timeout: 3_000, maxBuffer: 1024 * 1024 },
    );
    const pid = Number(String(stdout).trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function productionContinuity() {
  return {
    runtime8788: await listenerPid(8788),
    mcp8790: await listenerPid(8790),
    host8791: await listenerPid(8791),
  };
}

async function waitFor(check, timeoutMs, message) {
  const deadline = performance.now() + timeoutMs;
  let lastError = null;
  while (performance.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(50);
  }
  throw new Error(
    message +
      (lastError
        ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}`
        : ""),
  );
}

async function startJsonCloudServer(port, state) {
  const server = http.createServer((req, res) => {
    state.requests += 1;
    req.resume();
    if (state.mode === "hang") {
      req.on("close", () => undefined);
      return;
    }
    if (state.mode === "503") {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: "TEMPORARY_UNAVAILABLE",
          message: "Injected Cloud outage.",
        }),
      );
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ calls: [] }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

function fakeExecutor() {
  return {
    execute() {
      throw new Error("Fault lane unexpectedly executed a local MCP tool.");
    },
    snapshot: () => null,
  };
}

async function f1CloudUnavailableThenRecover() {
  const port = await allocatePort();
  const client = new CloudHttpClient({
    baseUrl: `http://127.0.0.1:${port}`,
    deviceCredential: "owldev1.fault-matrix",
    timeoutMs: 250,
  });
  const consumer = new CloudMcpCallConsumer({
    cloudClient: client,
    executor: fakeExecutor(),
    pollIntervalMs: 100,
    random: () => 0.5,
  });

  const startedAt = performance.now();
  const degraded = await consumer.start();
  assert(degraded.state === "degraded", "F1 did not enter degraded state.", degraded);
  assert(
    degraded.lastError?.code === "CLOUD_NETWORK_ERROR",
    "F1 did not expose a Cloud network failure.",
    degraded,
  );

  const state = { mode: "ok", requests: 0 };
  const server = await startJsonCloudServer(port, state);
  try {
    const recovered = await waitFor(
      () => {
        const snapshot = consumer.snapshot();
        return snapshot.ready ? snapshot : null;
      },
      4_000,
      "F1 did not recover after Cloud became reachable",
    );
    return {
      pass: true,
      initialState: degraded.state,
      recoveredState: recovered.state,
      recoveredInMs: Math.round(performance.now() - startedAt),
      recoveryRequests: state.requests,
      noLocalExecution: true,
    };
  } finally {
    await consumer.stop();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function f2Http503AndTimeoutRecover() {
  const port = await allocatePort();
  const state = { mode: "503", requests: 0 };
  const server = await startJsonCloudServer(port, state);
  const client = new CloudHttpClient({
    baseUrl: `http://127.0.0.1:${port}`,
    deviceCredential: "owldev1.fault-matrix",
    timeoutMs: 180,
  });
  const consumer = new CloudMcpCallConsumer({
    cloudClient: client,
    executor: fakeExecutor(),
    pollIntervalMs: 60_000,
    random: () => 0.5,
  });

  try {
    const unavailable = await consumer.start();
    assert(
      unavailable.state === "degraded" &&
        unavailable.lastError?.code === "TEMPORARY_UNAVAILABLE",
      "F2 did not surface HTTP 503 as degraded.",
      unavailable,
    );

    state.mode = "hang";
    const timedOut = await consumer.tick();
    assert(
      timedOut.state === "degraded" &&
        timedOut.lastError?.code === "CLOUD_TIMEOUT" &&
        timedOut.failureCount >= 2,
      "F2 did not surface bounded Cloud timeout.",
      timedOut,
    );

    state.mode = "ok";
    const recovered = await consumer.tick();
    assert(
      recovered.ready === true && recovered.failureCount === 0,
      "F2 did not recover after 503/timeout.",
      recovered,
    );

    return {
      pass: true,
      http503Code: unavailable.lastError?.code,
      timeoutCode: timedOut.lastError?.code,
      peakFailureCount: timedOut.failureCount,
      recoveredState: recovered.state,
      requests: state.requests,
    };
  } finally {
    await consumer.stop();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function startIsolatedRuntime(scratch) {
  const port = await allocatePort();
  const stateRoot = path.join(scratch, "runtime-state");
  const runtimeToken = "fault-" + randomBytes(24).toString("base64url");
  const tsx = path.join(runtimeRoot, "node_modules", ".bin", "tsx");
  assert(fs.existsSync(tsx), "Runtime tsx binary is missing.", { tsx });

  const child = spawn(tsx, ["src/server.ts"], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      PORT: String(port),
      OWL_RUNTIME_MODE: "development",
      OWL_RUNTIME_ACCESS_MODE: "compat",
      OWL_APPROVAL_MODE: "compat",
      OWL_STATE_ROOT: stateRoot,
      OWL_RUNTIME_API_TOKEN: runtimeToken,
      ALLOWED_DIRECTORIES: scratch,
      ALLOW_WRITE: "true",
      ALLOW_SHELL: "false",
      ALLOW_BROWSER: "false",
      ALLOW_GUI: "false",
      AUDIT_LOG_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(
    async () => {
      if (child.exitCode !== null) {
        throw new Error(
          `isolated Runtime exited code=${child.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
      }
      const response = await fetch(baseUrl + "/health", {
        signal: AbortSignal.timeout(500),
      });
      return response.ok;
    },
    20_000,
    "Isolated Runtime did not become healthy",
  );

  return {
    child,
    baseUrl,
    runtimeToken,
    port,
    stateRoot,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function stopChild(child, signal = "SIGTERM", timeoutMs = 4_000) {
  if (!child || child.exitCode !== null) return;
  child.kill(signal);
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(timeoutMs).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

function workerEnv(runtime, input) {
  return {
    ...process.env,
    OWL_FAULT_PHASE: input.phase,
    OWL_FAULT_RUNTIME_URL: runtime.baseUrl,
    OWL_FAULT_RUNTIME_TOKEN: runtime.runtimeToken,
    OWL_FAULT_COMPLETION_ROOT: input.completionRoot,
    OWL_FAULT_TARGET_FILE: input.targetFile,
    OWL_FAULT_RESULT_FILE: input.resultFile,
    OWL_FAULT_CALL_ID: input.callId,
    OWL_FAULT_OWNER_ID: input.ownerId,
    OWL_FAULT_REQUEST_DIGEST: input.requestDigest,
    ...(input.markerFile ? { OWL_FAULT_MARKER_FILE: input.markerFile } : {}),
  };
}

async function runWorker(runtime, input, { expectExit = 0 } = {}) {
  const child = spawn(process.execPath, [workerPath], {
    cwd: root,
    env: workerEnv(runtime, input),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert(code === expectExit, "Fault worker exited unexpectedly.", {
    phase: input.phase,
    code,
    stdout,
    stderr,
  });
  assert(fs.existsSync(input.resultFile), "Fault worker wrote no result.", {
    phase: input.phase,
    stdout,
    stderr,
  });
  return {
    child,
    result: JSON.parse(fs.readFileSync(input.resultFile, "utf8")),
    stdout,
    stderr,
  };
}

function readSideEffects(targetFile) {
  if (!fs.existsSync(targetFile)) return [];
  return fs
    .readFileSync(targetFile, "utf8")
    .split("\n")
    .filter(Boolean);
}

async function f3DuplicateDelivery(runtime, scratch) {
  const targetFile = path.join(scratch, "f3-side-effect.txt");
  const completionRoot = path.join(scratch, "f3-completions");
  const resultFile = path.join(scratch, "f3-result.json");
  const run = await runWorker(runtime, {
    phase: "f3-duplicate",
    completionRoot,
    targetFile,
    resultFile,
    callId: "mcp_fault_f3",
    ownerId: "owl-fault-owner-f3",
    requestDigest: "fault-f3-v1",
  });
  const effects = readSideEffects(targetFile);
  assert(
    run.result.executeCount === 2,
    "F3 did not force duplicate Desktop execution attempts.",
    run.result,
  );
  assert(effects.length === 1, "F3 duplicated the consequential side effect.", {
    effects,
    result: run.result,
  });
  assert(
    run.result.completionAttempts === 2,
    "F3 did not complete both redeliveries.",
    run.result,
  );
  return {
    pass: true,
    desktopExecutionAttempts: run.result.executeCount,
    cloudCompletions: run.result.completionAttempts,
    sideEffectCount: effects.length,
    runtimeReplayPreventedDuplicate: true,
  };
}

async function f4CompletionAckLoss(runtime, scratch) {
  const targetFile = path.join(scratch, "f4-side-effect.txt");
  const completionRoot = path.join(scratch, "f4-completions");
  const firstResult = path.join(scratch, "f4-loss.json");
  const secondResult = path.join(scratch, "f4-recover.json");
  const shared = {
    completionRoot,
    targetFile,
    callId: "mcp_fault_f4",
    ownerId: "owl-fault-owner-f4",
    requestDigest: "fault-f4-v1",
  };

  const lost = await runWorker(runtime, {
    ...shared,
    phase: "f4-ack-loss",
    resultFile: firstResult,
  });
  assert(
    lost.result.consumer?.state === "degraded",
    "F4 loss did not degrade consumer.",
    lost.result,
  );
  assert(
    lost.result.executeCount === 1,
    "F4 first execution count is wrong.",
    lost.result,
  );
  assert(
    lost.result.completionPending === 1,
    "F4 completion was not journaled before ACK loss.",
    lost.result,
  );
  assert(
    readSideEffects(targetFile).length === 1,
    "F4 initial side effect did not occur exactly once.",
  );

  const recovered = await runWorker(runtime, {
    ...shared,
    phase: "f4-ack-recover",
    resultFile: secondResult,
  });
  assert(
    recovered.result.executeCount === 0,
    "F4 replay re-executed local MCP instead of journal replay.",
    recovered.result,
  );
  assert(
    recovered.result.completionPending === 0,
    "F4 journal was not cleared after ACK recovery.",
    recovered.result,
  );
  assert(
    readSideEffects(targetFile).length === 1,
    "F4 recovery duplicated the side effect.",
  );

  return {
    pass: true,
    firstExecutionCount: lost.result.executeCount,
    pendingAfterAckLoss: lost.result.completionPending,
    recoveryExecutionCount: recovered.result.executeCount,
    pendingAfterRecovery: recovered.result.completionPending,
    sideEffectCount: 1,
    replaySource: "desktop_completion_journal",
  };
}

async function f5HostCrashAfterRuntimeReceipt(runtime, scratch) {
  const targetFile = path.join(scratch, "f5-side-effect.txt");
  const completionRoot = path.join(scratch, "f5-completions");
  const crashResult = path.join(scratch, "f5-crash.json");
  const recoverResult = path.join(scratch, "f5-recover.json");
  const markerFile = path.join(scratch, "f5-runtime-returned.marker");
  const shared = {
    completionRoot,
    targetFile,
    callId: "mcp_fault_f5",
    ownerId: "owl-fault-owner-f5",
    requestDigest: "fault-f5-v1",
  };

  const child = spawn(process.execPath, [workerPath], {
    cwd: root,
    env: workerEnv(runtime, {
      ...shared,
      phase: "f5-crash-window",
      resultFile: crashResult,
      markerFile,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  await waitFor(
    () => fs.existsSync(markerFile),
    20_000,
    "F5 never reached the post-Runtime/pre-journal crash window",
  );
  assert(
    readSideEffects(targetFile).length === 1,
    "F5 side effect was not committed before crash.",
  );
  const pendingBeforeCrash = fs.existsSync(completionRoot)
    ? fs.readdirSync(completionRoot).filter((name) => name.endsWith(".json"))
        .length
    : 0;
  assert(
    pendingBeforeCrash === 0,
    "F5 unexpectedly journaled completion before injected crash.",
    { pendingBeforeCrash },
  );

  child.kill("SIGKILL");
  const exit = await new Promise((resolve) => child.once("close", resolve));
  assert(exit !== 0, "F5 SIGKILL worker exited as success.", {
    exit,
    stdout,
    stderr,
  });

  const recovered = await runWorker(runtime, {
    ...shared,
    phase: "f5-recover",
    resultFile: recoverResult,
  });
  const effects = readSideEffects(targetFile);
  assert(
    recovered.result.executeCount === 1,
    "F5 recovery did not re-enter local MCP exactly once.",
    recovered.result,
  );
  assert(effects.length === 1, "F5 recovery duplicated the consequential side effect.", {
    effects,
    result: recovered.result,
  });
  assert(
    recovered.result.completionPending === 0,
    "F5 recovery left completion journal pending.",
    recovered.result,
  );

  return {
    pass: true,
    injectedWindow:
      "runtime_terminal_receipt_committed_before_desktop_completion_journal",
    hostExit: "SIGKILL",
    desktopRecoveryExecutionAttempts: recovered.result.executeCount,
    sideEffectCount: effects.length,
    runtimeReplayPreventedDuplicate: true,
    completionPendingAfterRecovery: recovered.result.completionPending,
  };
}

const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "owl-cloud-mcp-fault-matrix-"),
);
fs.mkdirSync(evidenceDir, { recursive: true });
const productionBefore = await productionContinuity();
let runtime = null;
const startedAt = new Date().toISOString();

try {
  const f1 = await f1CloudUnavailableThenRecover();
  const f2 = await f2Http503AndTimeoutRecover();

  runtime = await startIsolatedRuntime(scratch);
  const f3 = await f3DuplicateDelivery(runtime, scratch);
  const f4 = await f4CompletionAckLoss(runtime, scratch);
  const f5 = await f5HostCrashAfterRuntimeReceipt(runtime, scratch);

  const productionAfter = await productionContinuity();
  for (const key of Object.keys(productionBefore)) {
    assert(
      productionAfter[key] === productionBefore[key],
      `Production listener changed during isolated fault matrix: ${key}`,
      { productionBefore, productionAfter },
    );
  }

  const evidence = {
    ok: true,
    gate: "isolated Cloud MCP fault matrix F1-F5",
    startedAt,
    completedAt: new Date().toISOString(),
    desktopHead: null,
    runtimeHead: null,
    isolation: {
      scratchRoot: "<temporary-removed-after-run>",
      isolatedRuntimePort: runtime.port,
      isolatedRuntimeStateRoot: "<temporary-removed-after-run>",
      productionBefore,
      productionAfter,
      productionListenersUnchanged: true,
      productionTunnelTouched: false,
    },
    lanes: { f1, f2, f3, f4, f5 },
    acceptance: {
      lostDurableCalls: 0,
      duplicateSideEffects: 0,
      falseReadyObserved: 0,
      productionRuntimeTaskLoss: 0,
    },
  };

  try {
    const { stdout } = await execFileAsync("/usr/bin/git", ["rev-parse", "HEAD"], {
      cwd: root,
      timeout: 3_000,
    });
    evidence.desktopHead = stdout.trim();
  } catch {}
  try {
    const { stdout } = await execFileAsync("/usr/bin/git", ["rev-parse", "HEAD"], {
      cwd: runtimeRoot,
      timeout: 3_000,
    });
    evidence.runtimeHead = stdout.trim();
  } catch {}

  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (runtime?.child) await stopChild(runtime.child);
  fs.rmSync(scratch, { recursive: true, force: true });
}
