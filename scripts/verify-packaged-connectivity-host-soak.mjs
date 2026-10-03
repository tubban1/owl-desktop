#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { app } from "electron";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { DesktopStore } from "../electron/store.mjs";
import { ConnectivityHostLaunchAgent } from "../electron/services/connectivity-host-launch-agent.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cycles = Math.max(
  1,
  Math.min(500, Number(process.env.OWL_PACKAGED_CONNECTIVITY_SOAK_CYCLES || "100")),
);
const mcpPort = Number(process.env.OWL_PACKAGED_CONNECTIVITY_SOAK_MCP_PORT || "8890");
const controlPort = Number(
  process.env.OWL_PACKAGED_CONNECTIVITY_SOAK_CONTROL_PORT || "8891",
);
const bridgePort = Number(
  process.env.OWL_PACKAGED_CONNECTIVITY_SOAK_BRIDGE_PORT || "8892",
);
const label =
  process.env.OWL_PACKAGED_CONNECTIVITY_SOAK_LABEL?.trim() ||
  "ai.owl.desktop.connectivity-host.soak";
const packagedBinary = path.resolve(
  process.env.OWL_PACKAGED_CONNECTIVITY_BINARY?.trim() ||
    path.join(
      root,
      "release/smoke-arm64/mac-arm64/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
    ),
);

function required(value, message) {
  if (!value) throw new Error(message);
  return value;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listenerPids(port) {
  try {
    const { stdout } = await execFileAsync(
      "/usr/sbin/lsof",
      ["-nP", "-tiTCP:" + String(port), "-sTCP:LISTEN"],
      { timeout: 4_000, maxBuffer: 1024 * 1024 },
    );
    return String(stdout)
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function listenerPid(port) {
  return (await listenerPids(port))[0] ?? null;
}

async function waitForHealth(controlToken, predicate, timeoutMs = 15_000) {
  const deadline = performance.now() + timeoutMs;
  let lastError = null;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${controlPort}/health`, {
        headers: { authorization: `Bearer ${controlToken}` },
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok === true && predicate(payload)) {
        return payload;
      }
      lastError = new Error("isolated Host health is not ready");
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(
    `Isolated Connectivity Host health timed out: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function parseRuntimeInfo(result) {
  if (result?.isError === true) throw new Error("runtime_info returned MCP isError");
  const text = Array.isArray(result?.content)
    ? result.content.find(
        (entry) =>
          entry &&
          entry.type === "text" &&
          typeof entry.text === "string",
      )?.text
    : null;
  const parsed = text ? JSON.parse(text) : null;
  if (
    parsed?.apiVersion !== "0.1" ||
    typeof parsed?.runtimeVersion !== "string" ||
    !parsed.runtimeVersion
  ) {
    throw new Error("runtime_info returned no Runtime contract evidence");
  }
  return parsed;
}

async function runtimeInfo(mcpToken) {
  const client = new Client({
    name: "owl-packaged-host-soak",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${mcpPort}/mcp`),
    {
      requestInit: {
        headers: {
          authorization: `Bearer ${mcpToken}`,
        },
      },
    },
  );
  try {
    await client.connect(transport);
    return parseRuntimeInfo(
      await client.callTool({
        name: "runtime_info",
        arguments: {},
      }),
    );
  } finally {
    await transport.close().catch(() => undefined);
  }
}

async function bootout(service) {
  await execFileAsync(
    "/bin/launchctl",
    ["bootout", `gui/${process.getuid()}/${service.launchdLabel}`],
    { timeout: 8_000, maxBuffer: 1024 * 1024 },
  ).catch(() => undefined);
}

async function waitForIsolatedHostExit(service, timeoutMs = 8_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const [mcpPids, controlPids] = await Promise.all([
      listenerPids(mcpPort),
      listenerPids(controlPort),
    ]);
    let loaded = false;
    try {
      await execFileAsync(
        "/bin/launchctl",
        ["print", `gui/${process.getuid()}/${service.launchdLabel}`],
        { timeout: 2_000, maxBuffer: 1024 * 1024 },
      );
      loaded = true;
    } catch {
      loaded = false;
    }
    if (!loaded && mcpPids.length === 0 && controlPids.length === 0) return;
    await sleep(100);
  }
  throw new Error(
    "Isolated Connectivity Host did not fully exit during cleanup.",
  );
}

async function removeTreeEventually(root, timeoutMs = 5_000) {
  const deadline = performance.now() + timeoutMs;
  let lastError = null;
  while (performance.now() < deadline) {
    try {
      fs.rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
      });
      return;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw lastError ?? new Error(`Failed to remove temporary tree: ${root}`);
}

export async function runPackagedConnectivityHostSoak() {
  app.dock?.hide();
  required(fs.existsSync(packagedBinary), "Packaged Desktop binary is missing.");

  const canonicalRoot = path.join(
    app.getPath("appData"),
    "OWL LAB",
    "desktop",
  );
  const canonicalStore = new DesktopStore({ root: canonicalRoot });
  const canonicalSettings = canonicalStore.getSettings();
  const runtimeToken =
    canonicalStore.readSecret("OWL_RUNTIME_API_TOKEN", "owl-runtime") ??
    canonicalStore.readSecret("OWL_RUNTIME_API_TOKEN");
  required(runtimeToken, "Runtime API token is unavailable.");

  const runtimePidBefore = await listenerPid(8788);
  const productionMcpPidBefore = await listenerPid(8790);
  const productionHostPidBefore = await listenerPid(8791);
  required(runtimePidBefore, "Runtime is not listening on 8788.");
  required(productionMcpPidBefore, "Production MCP is not listening on 8790.");
  required(productionHostPidBefore, "Production Connectivity Host is not listening on 8791.");

  if ((await listenerPids(mcpPort)).length || (await listenerPids(controlPort)).length) {
    throw new Error(
      `Soak ports are already occupied: MCP ${mcpPort}, control ${controlPort}`,
    );
  }

  const soakRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "owl-packaged-connectivity-soak-"),
  );
  const storeRoot = path.join(soakRoot, "store");
  const hostDataRoot = path.join(soakRoot, "host-data");
  const logDir = path.join(soakRoot, "logs");
  const soakStore = new DesktopStore({ root: storeRoot });
  const controlToken = randomBytes(32).toString("base64url");
  const mcpToken = randomBytes(32).toString("base64url");

  soakStore.updateSettings({
    runtimeBaseUrl: canonicalSettings.runtimeBaseUrl || "http://127.0.0.1:8788",
    mcpPort,
    cloudEnabled: false,
    connectivityMode: "cloud_durable",
    tunnelEnabled: false,
    tunnelAutoStart: false,
  });
  soakStore.upsertSecret({
    name: "OWL_RUNTIME_API_TOKEN",
    project: "owl-runtime",
    value: runtimeToken,
  });
  soakStore.upsertSecret({
    name: "OWL_MCP_API_TOKEN",
    project: "owl-desktop",
    value: mcpToken,
  });
  soakStore.upsertSecret({
    name: "OWL_CONNECTION_HOST_CONTROL_TOKEN",
    project: "owl-connectivity",
    value: controlToken,
  });

  const service = new ConnectivityHostLaunchAgent({
    desktopExecPath: packagedBinary,
    launchdLabel: label,
    throttleIntervalSeconds: 1,
    logDir,
    environmentVariables: {
      OWL_CONNECTIVITY_HOST_STORE_ROOT: storeRoot,
      OWL_CONNECTION_HOST_PORT: String(controlPort),
      OWL_MCP_PORT: String(mcpPort),
      OWL_DESKTOP_USER_DATA_DIR: hostDataRoot,
      OWL_DESKTOP_CAPABILITY_BRIDGE_PORT: String(bridgePort),
    },
  });

  const restartLatencyMs = [];
  let completedCycles = 0;
  let runtimeEvidence = null;

  try {
    await bootout(service);
    fs.rmSync(service.launchAgent, { force: true });
    await service.ensure();

    let health = await waitForHealth(
      controlToken,
      (payload) =>
        Number(payload?.pid) > 0 &&
        payload?.mcp?.status === "running",
      20_000,
    );
    runtimeEvidence = await runtimeInfo(mcpToken);

    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      const previousPid = Number(health.pid);
      const started = performance.now();
      process.kill(previousPid, "SIGKILL");
      health = await waitForHealth(
        controlToken,
        (payload) =>
          Number(payload?.pid) > 0 &&
          Number(payload.pid) !== previousPid &&
          payload?.mcp?.status === "running",
        20_000,
      );
      restartLatencyMs.push(performance.now() - started);
      runtimeEvidence = await runtimeInfo(mcpToken);

      const [mcpPids, controlPids] = await Promise.all([
        listenerPids(mcpPort),
        listenerPids(controlPort),
      ]);
      if (
        mcpPids.length !== 1 ||
        controlPids.length !== 1 ||
        mcpPids[0] !== Number(health.pid) ||
        controlPids[0] !== Number(health.pid)
      ) {
        throw new Error(
          `Listener leak after cycle ${cycle}: mcp=${mcpPids.join(",")} control=${controlPids.join(",")} host=${health.pid}`,
        );
      }
      completedCycles = cycle;
    }

    const runtimePidAfter = await listenerPid(8788);
    const productionMcpPidAfter = await listenerPid(8790);
    const productionHostPidAfter = await listenerPid(8791);
    if (runtimePidAfter !== runtimePidBefore) {
      throw new Error(
        `Runtime PID changed during soak: ${runtimePidBefore} -> ${runtimePidAfter}`,
      );
    }
    if (productionMcpPidAfter !== productionMcpPidBefore) {
      throw new Error(
        `Production MCP PID changed during isolated soak: ${productionMcpPidBefore} -> ${productionMcpPidAfter}`,
      );
    }
    if (productionHostPidAfter !== productionHostPidBefore) {
      throw new Error(
        `Production Host PID changed during isolated soak: ${productionHostPidBefore} -> ${productionHostPidAfter}`,
      );
    }

    const sorted = [...restartLatencyMs].sort((a, b) => a - b);
    const percentile = (fraction) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
      0;

    console.log(
      JSON.stringify(
        {
          ok: true,
          gate: "isolated packaged Connectivity Host restart soak",
          cycles,
          completedCycles,
          packagedBinary,
          isolated: true,
          testLabel: label,
          testMcpPort: mcpPort,
          testControlPort: controlPort,
          runtimePidBefore,
          runtimePidAfter,
          runtimeSurvived: runtimePidAfter === runtimePidBefore,
          productionMcpPidBefore,
          productionMcpPidAfter,
          productionMcpUnaffected:
            productionMcpPidBefore === productionMcpPidAfter,
          productionHostPidBefore,
          productionHostPidAfter,
          productionHostUnaffected:
            productionHostPidBefore === productionHostPidAfter,
          runtimeVersion: runtimeEvidence?.runtimeVersion ?? null,
          runtimeApiVersion: runtimeEvidence?.apiVersion ?? null,
          restartLatencyMs: {
            min: Math.round(sorted[0] ?? 0),
            p50: Math.round(percentile(0.5)),
            p95: Math.round(percentile(0.95)),
            max: Math.round(sorted[sorted.length - 1] ?? 0),
          },
          listenerLeaks: 0,
          secretsPrinted: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await bootout(service);
    await waitForIsolatedHostExit(service).catch(() => undefined);
    fs.rmSync(service.launchAgent, { force: true });
    await removeTreeEventually(soakRoot);
  }
}
