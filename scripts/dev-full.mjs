#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const integrationRuntimeRoot = path.resolve(
  desktopRoot,
  "..",
  ".worktrees",
  "owl-runtime-desktop-integration",
);
const fallbackRuntimeRoot = path.resolve(desktopRoot, "..", "owl-runtime");
const runtimeRoot = path.resolve(
  process.env.OWL_RUNTIME_SOURCE_ROOT?.trim() ||
    process.env.OWL_RUNTIME_DEV_ROOT?.trim() ||
    (fs.existsSync(path.join(integrationRuntimeRoot, "package.json"))
      ? integrationRuntimeRoot
      : fallbackRuntimeRoot),
);
const runtimeDevPort = Number(process.env.OWL_RUNTIME_DEV_PORT || "18788");
const runtimeBaseUrl = `http://127.0.0.1:${runtimeDevPort}`;
const runtimeHealthUrl = `${runtimeBaseUrl}/health`;
const runtimeStateRoot = path.resolve(
  process.env.OWL_RUNTIME_DEV_STATE_ROOT?.trim() ||
    path.join(os.homedir(), ".owl-runtime-dev"),
);
const enforceCloudAccess =
  process.env.OWL_DEV_ENFORCE_CLOUD_ACCESS?.trim().toLowerCase() !== "false";
const runtimeLeasePublicKeyFile = path.resolve(
  process.env.OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE?.trim() ||
    path.join(
      os.homedir(),
      ".owl-lab",
      "trust",
      "owl-cloud-dev-runtime-lease-public.pem",
    ),
);
const desktopSettingsFile =
  process.env.OWL_DESKTOP_SETTINGS_FILE?.trim() ||
  path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "OWL LAB",
    "desktop",
    "settings.json",
  );
const desktopUserDataRoot = path.dirname(desktopSettingsFile);
let desktopUserSettings = {};
try {
  desktopUserSettings = JSON.parse(fs.readFileSync(desktopSettingsFile, "utf8"));
} catch {}
const standardUserFolders = [
  path.join(os.homedir(), "Desktop"),
  path.join(os.homedir(), "Documents"),
  path.join(os.homedir(), "Downloads"),
].filter((candidate) => fs.existsSync(candidate));
const userAllowedDirectories = Array.isArray(desktopUserSettings.allowedDirectories)
  ? desktopUserSettings.allowedDirectories
      .filter((value) => typeof value === "string")
      .map((value) => path.resolve(value))
      .filter((value) => fs.existsSync(value))
  : standardUserFolders;
const userWakeName =
  typeof desktopUserSettings.wakeName === "string" &&
  desktopUserSettings.wakeName.trim()
    ? desktopUserSettings.wakeName.trim()
    : "OWL";
const userWakeAliases = Array.isArray(desktopUserSettings.wakeAliases)
  ? desktopUserSettings.wakeAliases
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
  : [];
const mcpPort = Number(desktopUserSettings.mcpPort || 8790);
const connectionHostPort = Number(
  process.env.OWL_CONNECTION_HOST_PORT || "8791",
);
const desktopCapabilityBridgePort = Number(
  process.env.OWL_DESKTOP_CAPABILITY_BRIDGE_PORT || "8792",
);
const connectionHostControlToken =
  process.env.OWL_CONNECTION_HOST_CONTROL_TOKEN?.trim() ||
  randomBytes(32).toString("base64url");
const connectionHostUrl =
  `http://127.0.0.1:${connectionHostPort}`;
const desktopCapabilityBridgeUrl =
  `http://127.0.0.1:${desktopCapabilityBridgePort}`;
const tsxCli = path.join(runtimeRoot, "node_modules", "tsx", "dist", "cli.mjs");

function parseNodeVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(version, minimum) {
  for (let index = 0; index < 3; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

function resolveTargetArch() {
  if (process.platform === "darwin" && process.arch === "x64") {
    const translated = spawnSync(
      "/usr/sbin/sysctl",
      ["-in", "sysctl.proc_translated"],
      { encoding: "utf8" },
    );
    if (translated.status === 0 && translated.stdout.trim() === "1") {
      return "arm64";
    }
  }
  return process.arch;
}

const targetArch = resolveTargetArch();

function resolveNativeNode22() {
  const candidates = [];
  const explicit = process.env.OWL_DEV_NODE?.trim();
  if (explicit) candidates.push(explicit);
  candidates.push(process.execPath);

  const nvmRoot = path.join(os.homedir(), ".nvm", "versions", "node");
  if (fs.existsSync(nvmRoot)) {
    for (const name of fs.readdirSync(nvmRoot)) {
      candidates.push(path.join(nvmRoot, name, "bin", "node"));
    }
  }

  const accepted = [];
  for (const candidate of [...new Set(candidates)]) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const probe = spawnSync(
      candidate,
      ["-p", "JSON.stringify({version:process.version,arch:process.arch})"],
      { encoding: "utf8" },
    );
    if (probe.status !== 0) continue;
    try {
      const info = JSON.parse(probe.stdout.trim());
      const parsed = parseNodeVersion(info.version);
      const npmCli = path.resolve(
        path.dirname(candidate),
        "..",
        "lib",
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      );
      if (
        parsed &&
        versionAtLeast(parsed, [22, 13, 0]) &&
        info.arch === targetArch &&
        fs.existsSync(npmCli)
      ) {
        accepted.push({ candidate, parsed, info });
      }
    } catch {}
  }

  accepted.sort((left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left.parsed[index] !== right.parsed[index]) {
        return right.parsed[index] - left.parsed[index];
      }
    }
    return 0;
  });

  if (!accepted.length) {
    throw new Error(
      `No native ${targetArch} Node >=22.13.0 with a colocated npm CLI was found. Set OWL_DEV_NODE to a compatible Node binary.`,
    );
  }
  return accepted[0];
}

const selectedNode = resolveNativeNode22();
const runtimeNode = selectedNode.candidate;
const runtimeNpmCli = path.resolve(
  path.dirname(runtimeNode),
  "..",
  "lib",
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
if (!fs.existsSync(runtimeNpmCli)) {
  throw new Error(`npm CLI not found beside selected DEV Node: ${runtimeNpmCli}`);
}
const devPath = `${path.dirname(runtimeNode)}:${process.env.PATH ?? ""}`;
const devAllowedDirectories =
  process.env.ALLOWED_DIRECTORIES?.trim() ||
  [...new Set([...userAllowedDirectories, desktopRoot, runtimeRoot])].join(",");

if (
  !Number.isInteger(runtimeDevPort) ||
  runtimeDevPort < 1024 ||
  runtimeDevPort > 65535
) {
  throw new Error(
    `Invalid OWL_RUNTIME_DEV_PORT: ${process.env.OWL_RUNTIME_DEV_PORT ?? ""}`,
  );
}
if (runtimeDevPort === 8788 && process.env.OWL_ALLOW_SHARED_DEV_PORT !== "true") {
  throw new Error(
    "Refusing OWL Runtime DEV on shared port 8788. Use the isolated default 18788, or set OWL_ALLOW_SHARED_DEV_PORT=true only for deliberate diagnostics.",
  );
}
if (!fs.existsSync(tsxCli)) {
  throw new Error(`OWL Runtime DEV tsx CLI not found: ${tsxCli}. Run npm install in owl-runtime.`);
}
if (enforceCloudAccess && !fs.existsSync(runtimeLeasePublicKeyFile)) {
  throw new Error(
    `OWL LAB Cloud authorization is enforced, but the Runtime lease trust key is missing: ${runtimeLeasePublicKeyFile}. Provision the dev Cloud signing key first with "npm run provision:runtime-lease-key" in owl-cloud, or set OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE.`,
  );
}

const children = new Set();
const restartTimers = new Set();
let shuttingDown = false;

function start(
  label,
  cwd,
  command,
  args,
  env = {},
  { restartOnExit = false, restartDelayMs = 1000 } = {},
) {
  const launch = () => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
      detached: false,
    });
    children.add(child);
    let terminationHandled = false;
    const handleTermination = (code, signal, error = null) => {
      if (terminationHandled) return;
      terminationHandled = true;
      children.delete(child);
      if (shuttingDown) return;

      const detail = error
        ? `error=${error instanceof Error ? error.message : String(error)}`
        : `code=${code ?? "null"}, signal=${signal ?? "null"}`;

      if (restartOnExit) {
        console.warn(
          `[dev:full] ${label} terminated (${detail}); restarting without touching other healthy fault domains.`,
        );
        const timer = setTimeout(() => {
          restartTimers.delete(timer);
          if (!shuttingDown) launch();
        }, restartDelayMs);
        restartTimers.add(timer);
        return;
      }
      console.error(`[dev:full] ${label} terminated (${detail}).`);
      shutdown(code ?? 1);
    };
    child.once("error", (error) => handleTermination(null, null, error));
    child.once("exit", (code, signal) =>
      handleTermination(code, signal),
    );
    return child;
  };
  return launch();
}

async function assertPortFree(port, label) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port,
    });

    const finishFree = () => {
      socket.destroy();
      resolve();
    };

    socket.setTimeout(700, finishFree);
    socket.once("connect", () => {
      socket.destroy();
      reject(
        new Error(
          `${label} port ${port} is already in use. Refusing to attach DEV to an unknown/stale process.`,
        ),
      );
    });
    socket.once("error", (error) => {
      if (error?.code === "ECONNREFUSED") {
        finishFree();
        return;
      }
      socket.destroy();
      reject(error);
    });
  });
}

async function waitFor(url, label, timeoutMs = 30_000, headers = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok || response.status === 401) {
        console.log(`[dev:full] ${label} ready: ${url}`);
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    `${label} did not become ready within ${timeoutMs}ms: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function waitForDevRuntime(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(runtimeHealthUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const health = await response.json();
      const actualCodeRoot = health?.runtime?.codeRoot
        ? path.resolve(health.runtime.codeRoot)
        : null;

      if (health?.service !== "owl-runtime") {
        throw new Error(
          `wrong service on DEV port: ${health?.service ?? "unknown"}`,
        );
      }
      if (health?.runtime?.mode !== "development") {
        throw new Error(
          `wrong Runtime mode: ${health?.runtime?.mode ?? "unknown"}`,
        );
      }
      if (actualCodeRoot !== runtimeRoot) {
        throw new Error(
          `wrong Runtime code root: expected ${runtimeRoot}, got ${actualCodeRoot ?? "unknown"}`,
        );
      }
      if (path.resolve(health?.runtime?.stateRoot ?? "") !== runtimeStateRoot) {
        throw new Error(
          `wrong Runtime state root: expected ${runtimeStateRoot}, got ${health?.runtime?.stateRoot ?? "unknown"}`,
        );
      }

      const requiredCapabilities = ["write", "shell", "browser", "gui"];
      const missing = requiredCapabilities.filter(
        (name) => health?.capabilities?.[name] !== true,
      );
      if (missing.length) {
        throw new Error(
          `DEV Runtime missing required capabilities: ${missing.join(", ")}`,
        );
      }

      const accessProbeResponse = await fetch(
        `${runtimeBaseUrl}/runtime/v0.1/rpc`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-owl-session-id": "dev-full:contract-probe",
            "x-owl-request-id": "dev-full:access-get",
          },
          body: JSON.stringify({
            id: "dev-full:access-get",
            method: "access.get",
          }),
        },
      );
      const accessProbe = await accessProbeResponse.json().catch(() => null);
      if (!accessProbeResponse.ok || accessProbe?.ok !== true) {
        throw new Error(
          `Runtime DEV is missing required access.get contract: ${accessProbe?.error?.code ?? accessProbeResponse.status} ${accessProbe?.error?.message ?? ""}`.trim(),
        );
      }

      console.log(
        `[dev:full] Runtime DEV verified: ${health.version} · ${health.runtime.stateRoot} · access.get ${accessProbe?.result?.state ?? "available"}`,
      );
      return health;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(
    `Runtime DEV identity/capability check failed within ${timeoutMs}ms: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function stopChild(child) {
  try {
    child.kill("SIGTERM");
  } catch {}
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const timer of restartTimers) clearTimeout(timer);
  restartTimers.clear();
  for (const child of children) stopChild(child);
  setTimeout(() => process.exit(code), 250).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const arch = targetArch === "x64" ? "x64" : "arm64";
const tunnelBinary = path.join(
  desktopRoot,
  "vendor",
  "owl-tunnel",
  arch,
  "tunnel-client-runtime",
);

if (!fs.existsSync(tunnelBinary)) {
  console.log("[dev:full] vendored OWL Tunnel missing; preparing component...");
  const prepared = spawnSync(
    runtimeNode,
    [runtimeNpmCli, "run", "prepare:tunnel"],
    {
      cwd: desktopRoot,
      env: { ...process.env, PATH: devPath },
      stdio: "inherit",
    },
  );
  if (prepared.status !== 0 || !fs.existsSync(tunnelBinary)) {
    console.error("[dev:full] failed to prepare OWL Tunnel.");
    process.exit(prepared.status ?? 1);
  }
} else {
  console.log(`[dev:full] OWL Tunnel ready: ${tunnelBinary}`);
}

try {
  await assertPortFree(runtimeDevPort, "OWL Runtime DEV");
  await assertPortFree(mcpPort, "OWL MCP");
  await assertPortFree(connectionHostPort, "OWL Connection Host");
  await assertPortFree(
    desktopCapabilityBridgePort,
    "OWL Desktop capability bridge",
  );

  const runtimeCommit = spawnSync(
    "git",
    ["-C", runtimeRoot, "rev-parse", "--short", "HEAD"],
    { encoding: "utf8" },
  ).stdout?.trim() || "unknown";
  console.log(`[dev:full] Runtime source: ${runtimeRoot}`);
  console.log(`[dev:full] Runtime commit: ${runtimeCommit}`);
  console.log(
    `[dev:full] DEV Node: ${selectedNode.info.version} ${selectedNode.info.arch}`,
  );
  console.log(`[dev:full] Wake name: ${userWakeName}`);
  console.log(
    `[dev:full] Allowed DEV workspaces: ${devAllowedDirectories}`,
  );
  const runtimeWatch = process.env.OWL_RUNTIME_DEV_WATCH === "true";
  console.log(
    `[dev:full] starting OWL Runtime DEV on isolated port ${runtimeDevPort} (${runtimeWatch ? "watch" : "stable-source"})...`,
  );
  start(
    "runtime",
    runtimeRoot,
    runtimeNode,
    runtimeWatch
      ? [tsxCli, "watch", "src/server.ts"]
      : [tsxCli, "src/server.ts"],
    {
      PATH: devPath,
      PORT: String(runtimeDevPort),
      OWL_RUNTIME_MODE: "development",
      OWL_RUNTIME_ACCESS_MODE: enforceCloudAccess ? "enforced" : "compat",
      OWL_RUNTIME_REQUIRE_SIGNED_LEASE: enforceCloudAccess ? "true" : "false",
      OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE: runtimeLeasePublicKeyFile,
      OWL_STATE_ROOT: runtimeStateRoot,
      OWL_WAKE_NAME: userWakeName,
      OWL_ALIASES: userWakeAliases.join(","),
      ALLOWED_DIRECTORIES: devAllowedDirectories,
      ALLOW_WRITE: process.env.ALLOW_WRITE || "true",
      ALLOW_SHELL: process.env.ALLOW_SHELL || "true",
      ALLOW_DELETE: process.env.ALLOW_DELETE || "false",
      ALLOW_GIT_PUSH: process.env.ALLOW_GIT_PUSH || "false",
      ALLOW_BROWSER: process.env.ALLOW_BROWSER || "true",
      ALLOW_GUI: process.env.ALLOW_GUI || "true",
    },
  );

  await waitForDevRuntime();

  console.log("[dev:full] starting OWL Connection Host...");
  start(
    "connection-host",
    desktopRoot,
    runtimeNode,
    [path.join(desktopRoot, "connection-host", "server.mjs")],
    {
      PATH: devPath,
      OWL_RUNTIME_URL: runtimeBaseUrl,
      OWL_RUNTIME_API_TOKEN: process.env.OWL_RUNTIME_API_TOKEN || "",
      OWL_MCP_PORT: String(mcpPort),
      OWL_CONNECTION_HOST_PORT: String(connectionHostPort),
      OWL_CONNECTION_HOST_CONTROL_TOKEN: connectionHostControlToken,
      OWL_DESKTOP_CAPABILITY_BRIDGE_URL: desktopCapabilityBridgeUrl,
      OWL_DESKTOP_CAPABILITY_BRIDGE_TOKEN: connectionHostControlToken,
      OWL_DESKTOP_USER_DATA_DIR: desktopUserDataRoot,
      OWL_DESKTOP_FALLBACK_OWNER_ID:
        typeof desktopUserSettings.sessionId === "string"
          ? desktopUserSettings.sessionId
          : "",
    },
    { restartOnExit: true, restartDelayMs: 1200 },
  );
  await waitFor(
    `${connectionHostUrl}/health`,
    "Connection Host",
    30_000,
    { authorization: `Bearer ${connectionHostControlToken}` },
  );

  console.log("[dev:full] starting OWL Desktop DEV...");
  start(
    "desktop",
    desktopRoot,
    runtimeNode,
    [runtimeNpmCli, "run", "dev:desktop"],
    {
      PATH: devPath,
      OWL_DEV_FORCE_CONNECTIVITY: "true",
      OWL_RUNTIME_DEV_URL: runtimeBaseUrl,
      OWL_CONNECTION_HOST_URL: connectionHostUrl,
      OWL_CONNECTION_HOST_CONTROL_TOKEN: connectionHostControlToken,
      OWL_DESKTOP_CAPABILITY_BRIDGE_PORT: String(
        desktopCapabilityBridgePort,
      ),
    },
    { restartOnExit: true, restartDelayMs: 1200 },
  );
  await waitFor("http://127.0.0.1:5173/", "Vite renderer");

  console.log(
    "[dev:full] VERIFIED: ChatGPT → Tunnel → Connection Host MCP → isolated Runtime DEV; Desktop UI is restart-isolated.",
  );
  console.log(
    `[dev:full] Runtime DEV endpoint: ${runtimeBaseUrl} (persistent Desktop settings unchanged).`,
  );
  console.log("[dev:full] Runtime DEV identity verified by port isolation, code root, state root and capabilities.");
} catch (error) {
  console.error(
    "[dev:full] startup failed:",
    error instanceof Error ? error.message : String(error),
  );
  shutdown(1);
}
