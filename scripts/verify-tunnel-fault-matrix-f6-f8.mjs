#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { TunnelSupervisor } from "../electron/services/tunnel-supervisor.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(
  root,
  "release",
  "acceptance",
  "tunnel-fault-matrix-f6-f8",
);
const evidenceFile = path.join(evidenceDir, "fault-matrix-f6-f8.json");

function assert(condition, message, details) {
  if (condition) return;
  const suffix =
    details === undefined ? "" : "\n" + JSON.stringify(details, null, 2);
  throw new Error(message + suffix);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs, message) {
  const deadline = performance.now() + timeoutMs;
  let lastError = null;
  while (performance.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(25);
  }
  throw new Error(
    message +
      (lastError
        ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}`
        : ""),
  );
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

function writeFakeTunnel(binaryPath) {
  const source = `#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const healthFile = argValue("--health.url-file");
const modeFile = process.env.OWL_FAULT_TUNNEL_MODE_FILE;
const launchesFile = process.env.OWL_FAULT_TUNNEL_LAUNCHES_FILE;
if (!healthFile || !modeFile || !launchesFile) {
  process.stderr.write("missing fault fixture configuration\\n");
  process.exit(64);
}

fs.mkdirSync(path.dirname(healthFile), { recursive: true });
fs.appendFileSync(
  launchesFile,
  JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + "\\n",
);

function mode() {
  try {
    return fs.readFileSync(modeFile, "utf8").trim() || "healthy";
  } catch {
    return "healthy";
  }
}

let lastHealthySuccess = new Date().toISOString();

const server = http.createServer((req, res) => {
  const current = mode();
  if (req.url?.startsWith("/health")) {
    if (current === "half-open") {
      res.writeHead(200, { "content-type": "application/json" });
      res.flushHeaders();
      res.write('{"live":true,"components":');
      return;
    }
    if (current === "control-plane-loss") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          live: true,
          ready: true,
          components: {
            "control-plane": {
              status: "degraded",
              state: "backoff",
              reason_code: "network",
              observed_at: new Date().toISOString(),
              details: {
                last_success: lastHealthySuccess,
                last_error: new Date().toISOString(),
                consecutive_failures: 3,
                failure_category: "network",
              },
            },
          },
        }),
      );
      return;
    }
    const now = new Date().toISOString();
    lastHealthySuccess = now;
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        live: true,
        ready: true,
        components: {
          "control-plane": {
            status: "ok",
            state: "idle",
            observed_at: now,
            details: {
              last_success: now,
              consecutive_failures: 0,
            },
          },
        },
      }),
    );
    return;
  }

  if (req.url?.startsWith("/readyz")) {
    if (current === "healthy" || current === "control-plane-loss") {
      res.statusCode = 200;
      res.end("ready\\n");
    } else {
      res.statusCode = 503;
      res.end("not-ready\\n");
    }
    return;
  }

  res.statusCode = 404;
  res.end("not-found\\n");
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") process.exit(65);
  fs.writeFileSync(healthFile, "http://127.0.0.1:" + address.port + "\\n", {
    mode: 0o600,
  });
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
setInterval(() => {}, 60_000).unref();
`;
  fs.writeFileSync(binaryPath, source, { mode: 0o755 });
  fs.chmodSync(binaryPath, 0o755);
}

function launchRecords(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function proveReady(supervisor, timeoutMs = 5_000) {
  return await waitFor(
    async () => {
      if (!supervisor.child || !fs.existsSync(supervisor.healthUrlFile ?? "")) {
        return null;
      }
      const status = await supervisor.checkHealthNow();
      return status.reachability.state === "ready" ? status : null;
    },
    timeoutMs,
    "Tunnel did not prove Ready",
  );
}

function commonSupervisor(events, monotonicRef) {
  return new TunnelSupervisor({
    restartBaseDelayMs: 50,
    restartMaxDelayMs: 100,
    healthCheckIntervalMs: 500,
    healthRequestTimeoutMs: 250,
    healthStartupGraceMs: 0,
    healthStaleAfterMs: 1_000,
    random: () => 0.5,
    monotonicNow: () => monotonicRef.value,
    onEvent(level, message, meta) {
      events.push({ level, message, meta });
    },
  });
}

async function f6CrashReconnect(binaryPath, modeFile, launchesFile, monotonicRef) {
  fs.writeFileSync(modeFile, "healthy\n", "utf8");
  const events = [];
  const supervisor = commonSupervisor(events, monotonicRef);
  try {
    const initial = await supervisor.start({
      binaryPath,
      tunnelId: "fault_f6_tunnel_20261008",
      apiKey: "fault-only-secret-f6",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });
    assert(initial.state === "running", "F6 tunnel did not start.", initial);
    const readyBefore = await proveReady(supervisor);
    const firstPid = readyBefore.pid;
    const firstGeneration = readyBefore.generation;
    assert(firstPid, "F6 has no first Tunnel PID.", readyBefore);

    process.kill(firstPid, "SIGKILL");

    await waitFor(
      () => {
        const status = supervisor.status();
        return status.state === "restarting" || status.state === "running"
          ? status
          : null;
      },
      3_000,
      "F6 did not enter restart recovery after SIGKILL",
    );

    const replacement = await waitFor(
      () => {
        const status = supervisor.status();
        return status.pid && status.pid !== firstPid ? status : null;
      },
      5_000,
      "F6 did not spawn a replacement Tunnel",
    );
    const readyAfter = await proveReady(supervisor);
    const records = launchRecords(launchesFile);

    assert(
      readyAfter.pid !== firstPid,
      "F6 replacement reused the killed PID unexpectedly.",
      { firstPid, readyAfter },
    );
    assert(
      readyAfter.generation > firstGeneration,
      "F6 Tunnel generation did not advance.",
      { firstGeneration, readyAfter },
    );
    assert(
      records.length >= 2,
      "F6 fake Tunnel was not launched at least twice.",
      records,
    );
    assert(
      events.some((event) => event.message === "Tunnel restart scheduled"),
      "F6 emitted no restart scheduling evidence.",
      events,
    );

    return {
      pass: true,
      killedPid: firstPid,
      replacementPid: readyAfter.pid,
      firstGeneration,
      replacementGeneration: readyAfter.generation,
      launchCount: records.length,
      finalReachability: readyAfter.reachability.state,
      abnormalExitSignal: "SIGKILL",
    };
  } finally {
    await supervisor.stop();
  }
}

async function f7HalfOpenFalseGreen(
  binaryPath,
  modeFile,
  launchesFile,
  monotonicRef,
) {
  fs.writeFileSync(modeFile, "healthy\n", "utf8");
  const events = [];
  const supervisor = commonSupervisor(events, monotonicRef);
  try {
    await supervisor.start({
      binaryPath,
      tunnelId: "fault_f7_tunnel_20261008",
      apiKey: "fault-only-secret-f7",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });
    const readyBefore = await proveReady(supervisor);
    const firstPid = readyBefore.pid;
    const firstGeneration = readyBefore.generation;

    fs.writeFileSync(modeFile, "half-open\n", "utf8");
    monotonicRef.value += 1_500;

    const halfOpenStatus = await supervisor.checkHealthNow();
    assert(
      halfOpenStatus.reachability.state !== "ready",
      "F7 reported Ready while the health response body was half-open.",
      halfOpenStatus,
    );
    assert(
      ["recovering", "stale"].includes(halfOpenStatus.reachability.state) ||
        halfOpenStatus.state === "restarting",
      "F7 did not enter stale/recovering state after half-open timeout.",
      halfOpenStatus,
    );
    assert(
      halfOpenStatus.reachability.lastError?.code === "TUNNEL_HEALTH_TIMEOUT",
      "F7 did not classify the half-open probe as a health timeout.",
      halfOpenStatus,
    );

    fs.writeFileSync(modeFile, "healthy\n", "utf8");
    const replacement = await waitFor(
      () => {
        const status = supervisor.status();
        return status.pid && status.pid !== firstPid ? status : null;
      },
      5_000,
      "F7 did not replace the half-open Tunnel",
    );
    monotonicRef.value += 100;
    const readyAfter = await proveReady(supervisor);
    const records = launchRecords(launchesFile);

    assert(
      readyAfter.generation > firstGeneration,
      "F7 generation did not advance after stale recovery.",
      { firstGeneration, readyAfter },
    );
    assert(
      readyAfter.pid === replacement.pid,
      "F7 readiness was proven on an unexpected process generation.",
      { replacement, readyAfter },
    );
    assert(
      events.some(
        (event) =>
          event.message === "Tunnel reachability recovery started" &&
          event.meta?.reason === "health_probe_stale",
      ),
      "F7 emitted no stale-health recovery event.",
      events,
    );

    return {
      pass: true,
      initialPid: firstPid,
      replacementPid: readyAfter.pid,
      firstGeneration,
      replacementGeneration: readyAfter.generation,
      halfOpenErrorCode: halfOpenStatus.reachability.lastError?.code,
      halfOpenReportedReady: false,
      finalReachability: readyAfter.reachability.state,
      launchCount: records.length,
      recoveryReason: "health_probe_stale",
    };
  } finally {
    await supervisor.stop();
  }
}

async function f8ControlPlaneNetworkLoss(
  binaryPath,
  modeFile,
  launchesFile,
  monotonicRef,
) {
  fs.writeFileSync(modeFile, "healthy\n", "utf8");
  const events = [];
  const supervisor = commonSupervisor(events, monotonicRef);
  try {
    await supervisor.start({
      binaryPath,
      tunnelId: "fault_f8_tunnel_20261008",
      apiKey: "fault-only-secret-f8",
      mcpUrl: "http://127.0.0.1:8790/mcp",
    });
    const readyBefore = await proveReady(supervisor);
    const firstPid = readyBefore.pid;
    const firstGeneration = readyBefore.generation;

    fs.writeFileSync(modeFile, "control-plane-loss\n", "utf8");
    monotonicRef.value += 1_500;

    const lost = await supervisor.checkHealthNow();
    assert(
      lost.reachability.state !== "ready",
      "F8 reported Ready while control-plane evidence was stale.",
      lost,
    );
    assert(
      lost.reachability.lastError?.code === "TUNNEL_CONTROL_PLANE_STALE",
      "F8 did not classify stale upstream evidence correctly.",
      lost,
    );

    const staleTransition = events.find(
      (event) =>
        event.message === "Tunnel reachability changed" &&
        event.meta?.to === "stale" &&
        event.meta?.reason === "control_plane_stale",
    );
    assert(
      staleTransition?.meta?.localReady === true &&
        staleTransition?.meta?.controlPlaneStatus === "degraded",
      "F8 did not preserve the distinction between local readiness and upstream reachability.",
      { staleTransition, events },
    );
    assert(
      events.some(
        (event) =>
          event.message === "Tunnel reachability recovery started" &&
          event.meta?.reason === "control_plane_stale",
      ),
      "F8 emitted no control-plane stale recovery event.",
      events,
    );

    fs.writeFileSync(modeFile, "healthy\n", "utf8");
    const replacement = await waitFor(
      () => {
        const status = supervisor.status();
        return status.pid && status.pid !== firstPid ? status : null;
      },
      5_000,
      "F8 did not replace the Tunnel after control-plane loss",
    );
    monotonicRef.value += 100;
    const readyAfter = await proveReady(supervisor);
    const records = launchRecords(launchesFile);

    assert(
      readyAfter.generation > firstGeneration,
      "F8 generation did not advance after upstream recovery.",
      { firstGeneration, readyAfter },
    );
    assert(
      readyAfter.pid === replacement.pid,
      "F8 readiness was proven on an unexpected replacement process.",
      { replacement, readyAfter },
    );

    return {
      pass: true,
      initialPid: firstPid,
      replacementPid: readyAfter.pid,
      firstGeneration,
      replacementGeneration: readyAfter.generation,
      staleErrorCode: lost.reachability.lastError?.code,
      localReadyAtStaleDetection: true,
      controlPlaneStatusAtStaleDetection: "degraded",
      staleReportedReady: false,
      finalReachability: readyAfter.reachability.state,
      launchCount: records.length,
      recoveryReason: "control_plane_stale",
    };
  } finally {
    await supervisor.stop();
  }
}

const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "owl-tunnel-fault-matrix-f6-f8-"),
);
const isolatedTmp = path.join(scratch, "tmp");
fs.mkdirSync(isolatedTmp, { recursive: true, mode: 0o700 });
const fakeBinary = path.join(scratch, "tunnel-client-runtime");
const modeFile = path.join(scratch, "mode.txt");
const launchesFile = path.join(scratch, "launches.jsonl");
writeFakeTunnel(fakeBinary);

const previousTmpDir = process.env.TMPDIR;
const previousModeFile = process.env.OWL_FAULT_TUNNEL_MODE_FILE;
const previousLaunchesFile = process.env.OWL_FAULT_TUNNEL_LAUNCHES_FILE;
process.env.TMPDIR = isolatedTmp;
process.env.OWL_FAULT_TUNNEL_MODE_FILE = modeFile;
process.env.OWL_FAULT_TUNNEL_LAUNCHES_FILE = launchesFile;

fs.mkdirSync(evidenceDir, { recursive: true });
const productionBefore = await productionContinuity();
const startedAt = new Date().toISOString();
const monotonicRef = { value: 0 };

try {
  const f6 = await f6CrashReconnect(
    fakeBinary,
    modeFile,
    launchesFile,
    monotonicRef,
  );

  fs.rmSync(launchesFile, { force: true });
  monotonicRef.value = 0;

  const f7 = await f7HalfOpenFalseGreen(
    fakeBinary,
    modeFile,
    launchesFile,
    monotonicRef,
  );

  fs.rmSync(launchesFile, { force: true });
  monotonicRef.value = 0;

  const f8 = await f8ControlPlaneNetworkLoss(
    fakeBinary,
    modeFile,
    launchesFile,
    monotonicRef,
  );

  const productionAfter = await productionContinuity();
  for (const key of Object.keys(productionBefore)) {
    assert(
      productionBefore[key] === productionAfter[key],
      `Production listener changed during F6/F8: ${key}`,
      { productionBefore, productionAfter },
    );
  }

  let desktopHead = null;
  try {
    const { stdout } = await execFileAsync("/usr/bin/git", ["rev-parse", "HEAD"], {
      cwd: root,
      timeout: 3_000,
    });
    desktopHead = stdout.trim();
  } catch {}

  const evidence = {
    ok: true,
    gate: "isolated Tunnel fault matrix F6-F8",
    startedAt,
    completedAt: new Date().toISOString(),
    desktopHead,
    isolation: {
      scratchRoot: "<temporary-removed-after-run>",
      tmpDir: "<isolated-process-TMPDIR>",
      productionBefore,
      productionAfter,
      productionListenersUnchanged: true,
      productionTunnelTouched: false,
      productionTunnelCredentialsUsed: false,
    },
    lanes: { f6, f7, f8 },
    acceptance: {
      falseReadyObserved: 0,
      productionRuntimeTaskLoss: 0,
      productionListenerChanges: 0,
    },
  };

  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (previousTmpDir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmpDir;
  if (previousModeFile === undefined) delete process.env.OWL_FAULT_TUNNEL_MODE_FILE;
  else process.env.OWL_FAULT_TUNNEL_MODE_FILE = previousModeFile;
  if (previousLaunchesFile === undefined) {
    delete process.env.OWL_FAULT_TUNNEL_LAUNCHES_FILE;
  } else {
    process.env.OWL_FAULT_TUNNEL_LAUNCHES_FILE = previousLaunchesFile;
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}
