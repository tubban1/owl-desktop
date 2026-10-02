#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { app } from "electron";

import { DesktopStore } from "../electron/store.mjs";
import { CloudHttpClient } from "../electron/services/cloud-http-client.mjs";
import { CloudAccountAuth } from "../electron/services/cloud-account-auth.mjs";
import { ConnectivityHostLaunchAgent } from "../electron/services/connectivity-host-launch-agent.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagedBinary = path.resolve(
  process.env.OWL_PACKAGED_CONNECTIVITY_BINARY?.trim() ||
    path.join(
      root,
      "release/smoke-arm64/mac-arm64/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
    ),
);
const label = "ai.owl.desktop.connectivity-host";
const controlUrl = "http://127.0.0.1:8791";

function required(value, message) {
  if (!value) throw new Error(message);
  return value;
}

async function listenerPid(port) {
  try {
    const { stdout } = await execFileAsync(
      "/usr/sbin/lsof",
      ["-nP", "-tiTCP:" + String(port), "-sTCP:LISTEN"],
      { timeout: 4_000, maxBuffer: 1024 * 1024 },
    );
    const pid = Number(String(stdout).trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForHealth(token, predicate = () => true, timeoutMs = 20_000) {
  const deadline = performance.now() + timeoutMs;
  let lastError = null;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(controlUrl + "/health", {
        headers: { authorization: "Bearer " + token },
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok === true && predicate(payload)) return payload;
      lastError = new Error("Health payload not ready.");
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(
    "Connectivity Host health wait timed out: " +
      (lastError instanceof Error ? lastError.message : String(lastError)),
  );
}

function parseRuntimeInfo(result) {
  if (result?.isError === true) {
    throw new Error("runtime_info returned MCP isError.");
  }
  const text = Array.isArray(result?.content)
    ? result.content.find(
        (item) => item && item.type === "text" && typeof item.text === "string",
      )?.text
    : null;
  const parsed = text ? JSON.parse(text) : null;
  if (
    parsed?.apiVersion !== "0.1" ||
    typeof parsed?.runtimeVersion !== "string" ||
    !parsed.runtimeVersion
  ) {
    throw new Error("runtime_info did not return Runtime contract evidence.");
  }
  return parsed;
}

export async function runPackagedConnectivityHostLiveGate() {
  app.dock?.hide();
  const canonicalRoot = path.join(
    app.getPath("appData"),
    "OWL LAB",
    "desktop",
  );
  const store = new DesktopStore({ root: canonicalRoot });
  const settings = store.getSettings();

  let controlToken =
    store.readSecret("OWL_CONNECTION_HOST_CONTROL_TOKEN", "owl-connectivity") ??
    store.readSecret("OWL_CONNECTION_HOST_CONTROL_TOKEN");
  if (!controlToken) {
    controlToken = randomBytes(32).toString("base64url");
    store.upsertSecret({
      name: "OWL_CONNECTION_HOST_CONTROL_TOKEN",
      project: "owl-connectivity",
      value: controlToken,
    });
  }

  required(fs.existsSync(packagedBinary), "Packaged Desktop binary is missing.");
  const refreshToken = required(
    store.readSecret("OWL_CLOUD_ACCOUNT_REFRESH_TOKEN", "owl-cloud"),
    "Cloud refresh token is unavailable.",
  );
  required(settings.cloudBaseUrl?.trim(), "Cloud base URL is unavailable.");
  required(settings.cloudDeviceId?.trim(), "Cloud device ID is unavailable.");
  const runtimePidBefore = await listenerPid(8788);
  required(runtimePidBefore, "Production Runtime is not listening on 8788.");

  const service = new ConnectivityHostLaunchAgent({
    desktopExecPath: packagedBinary,
  });
  const launchAgentExisted = fs.existsSync(service.launchAgent);
  const launchAgentLoaded = await service.loaded();

  let sessionId = null;
  const authClient = new CloudHttpClient({ baseUrl: settings.cloudBaseUrl });
  const auth = new CloudAccountAuth({ cloudClient: authClient });
  const tokens = await auth.refresh(refreshToken);

  const gateway = async (request) => {
    const response = await fetch(
      settings.cloudBaseUrl.replace(/\/$/, "") + "/mcp",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + tokens.idToken,
          "content-type": "application/json",
          accept: "application/json",
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        body: JSON.stringify(request),
      },
    );
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(
        "Cloud MCP HTTP " +
          response.status +
          ": " +
          (payload?.message ?? payload?.error?.message ?? "request failed"),
      );
    }
    sessionId = response.headers.get("mcp-session-id") || sessionId;
    return payload;
  };

  try {
    await service.ensure();
    const firstHealth = await waitForHealth(
      controlToken,
      (health) =>
        health?.mcp?.status === "running" &&
        health?.cloudMcp?.consumer?.ready === true,
    );
    const firstHostPid = Number(firstHealth.pid);
    required(firstHostPid, "Connectivity Host returned no PID.");

    await gateway({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "owl-packaged-host-live", version: "1.0" },
      },
    });
    required(sessionId, "Cloud MCP initialize returned no session identity.");

    const firstCall = await gateway({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "owl_call",
        arguments: {
          deviceId: settings.cloudDeviceId,
          toolName: "runtime_info",
          arguments: {},
          waitMs: 15_000,
        },
      },
    });
    const firstRuntime = parseRuntimeInfo(firstCall?.result);
    process.kill(firstHostPid, "SIGKILL");
    const restartedHealth = await waitForHealth(
      controlToken,
      (health) =>
        Number(health?.pid) > 0 &&
        Number(health.pid) !== firstHostPid &&
        health?.mcp?.status === "running" &&
        health?.cloudMcp?.consumer?.ready === true,
      25_000,
    );
    const restartedHostPid = Number(restartedHealth.pid);

    const secondCall = await gateway({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "owl_call",
        arguments: {
          deviceId: settings.cloudDeviceId,
          toolName: "runtime_info",
          arguments: {},
          waitMs: 15_000,
        },
      },
    });
    const secondRuntime = parseRuntimeInfo(secondCall?.result);

    const runtimePidAfter = await listenerPid(8788);
    if (runtimePidAfter !== runtimePidBefore) {
      throw new Error(
        `Runtime PID changed during packaged Host restart: ${runtimePidBefore} -> ${runtimePidAfter}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          gate: "Packaged Connectivity Host destructive restart",
          packagedBinary,
          hostPidBefore: firstHostPid,
          hostPidAfter: restartedHostPid,
          hostRestarted: restartedHostPid !== firstHostPid,
          runtimePidBefore,
          runtimePidAfter,
          runtimeSurvived: runtimePidAfter === runtimePidBefore,
          firstRuntime,
          secondRuntime,
          cloudConsumerReady: restartedHealth.cloudMcp.consumer.ready === true,
          tunnelState: restartedHealth.tunnel?.state ?? null,
          secretsPrinted: false,
        },
        null,
        2,
      ),
    );
  } finally {
    if (!launchAgentLoaded) {
      await execFileAsync(
        "/bin/launchctl",
        ["bootout", `gui/${process.getuid()}/${label}`],
        { timeout: 8_000, maxBuffer: 1024 * 1024 },
      ).catch(() => undefined);
    }
    if (!launchAgentExisted) {
      fs.rmSync(service.launchAgent, { force: true });
    }
  }
}
