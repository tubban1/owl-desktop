import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { DesktopStore } from "./store.mjs";
import { RuntimeHttpClient } from "./runtime-http-client.mjs";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
import { RuntimeHostSupervisor } from "./services/runtime-host-supervisor.mjs";
import { TunnelSupervisor } from "./services/tunnel-supervisor.mjs";
import { IdentityVault } from "./services/identity-vault.mjs";
import { RuntimeSkillManagerPort } from "./services/skill-manager-port.mjs";
import { CloudHttpClient } from "./services/cloud-http-client.mjs";
import { CloudBridgeStore } from "./services/cloud-bridge-store.mjs";
import { CloudBridgeService } from "./services/cloud-bridge-service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let store;
let identityVault;
let tunnelSupervisor;
let cloudBridgeStore;
let cloudBridge;
let cloudBridgeState = {
  status: "stopped",
  running: false,
  lastErrorCode: null,
};
let mcpServer;
let mcpState = { status: "stopped", url: null, error: null };
const activity = [];

const record = (level, source, message, meta = {}) => {
  activity.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    level,
    source,
    message,
    meta,
  });
  if (activity.length > 200) activity.length = 200;
};

const collectionSize = (value, keys = []) => {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  if (value.result && typeof value.result === "object") {
    return collectionSize(value.result, keys);
  }
  return 0;
};

function runtimeToken() {
  return (
    store.readSecret("OWL_RUNTIME_API_TOKEN", "owl-runtime") ??
    store.readSecret("OWL_RUNTIME_API_TOKEN")
  );
}

function runtimeClient() {
  const settings = store.getSettings();
  return new RuntimeHttpClient({
    baseUrl: settings.runtimeBaseUrl,
    sessionId: settings.sessionId,
    token: runtimeToken(),
  });
}

function skillManagerPort() {
  return new RuntimeSkillManagerPort({ client: runtimeClient() });
}

function mcpToken() {
  return (
    store.readSecret("OWL_MCP_API_TOKEN", "owl-desktop") ??
    store.readSecret("OWL_MCP_API_TOKEN")
  );
}

function tunnelApiKey() {
  return (
    store.readSecret("OWL_TUNNEL_API_KEY", "owl-tunnel") ??
    store.readSecret("OWL_TUNNEL_API_KEY")
  );
}

function cloudDeviceCredential() {
  return (
    store.readSecret("OWL_CLOUD_DEVICE_CREDENTIAL", "owl-cloud") ??
    store.readSecret("OWL_CLOUD_DEVICE_CREDENTIAL")
  );
}

async function buildCloudPresence() {
  const info = await runtimeClient().info().catch(() => null);
  return {
    capabilities: {
      cloudBridge: "m1-polling-v1",
      supportedRemoteCommands: ["runtime.task.create"],
      runtimeReachable: Boolean(info),
      mcpAvailable: mcpState.status === "running",
      tunnelAvailable: tunnelSupervisor?.status().state === "running",
    },
    runtimeCompatibility: {
      desktopVersion: app.getVersion(),
      runtimeApiVersion: info?.apiVersion ?? null,
      runtimeVersion: info?.runtimeVersion ?? null,
      platform: process.platform,
      arch: process.arch,
      cloudBridgeContract: "v1",
    },
  };
}

function cloudBridgeSnapshot() {
  const settings = store.getSettings();
  const storeSnapshot = cloudBridgeStore?.snapshot() ?? {
    commandCounts: {
      processing: 0,
      accepted: 0,
      rejected: 0,
      uncertain: 0,
    },
    outboxPending: 0,
    commands: [],
  };
  return {
    baseUrl: settings.cloudBaseUrl,
    deviceId: settings.cloudDeviceId || null,
    configured: Boolean(
      settings.cloudBaseUrl &&
      settings.cloudDeviceId &&
      cloudDeviceCredential(),
    ),
    ...storeSnapshot,
    ...(cloudBridge?.snapshot() ?? cloudBridgeState),
  };
}

async function stopCloudBridge() {
  if (cloudBridge) {
    await cloudBridge.stop().catch(() => undefined);
    cloudBridge = undefined;
  }
  cloudBridgeState = {
    status: "stopped",
    running: false,
    lastErrorCode: null,
  };
  return cloudBridgeSnapshot();
}

async function startCloudBridge() {
  const settings = store.getSettings();
  await stopCloudBridge();

  if (!settings.cloudEnabled) return cloudBridgeSnapshot();

  if (!settings.cloudBaseUrl?.trim()) {
    cloudBridgeState = {
      status: "needs_configuration",
      running: false,
      lastErrorCode: "CLOUD_BASE_URL_MISSING",
    };
    return cloudBridgeSnapshot();
  }
  if (!settings.cloudDeviceId?.trim() || !cloudDeviceCredential()) {
    cloudBridgeState = {
      status: "needs_enrollment",
      running: false,
      lastErrorCode: "CLOUD_DEVICE_IDENTITY_MISSING",
    };
    return cloudBridgeSnapshot();
  }

  const client = new CloudHttpClient({
    baseUrl: settings.cloudBaseUrl,
    deviceCredential: cloudDeviceCredential(),
  });

  cloudBridge = new CloudBridgeService({
    client,
    runtimeClient: runtimeClient(),
    store: cloudBridgeStore,
    deviceId: settings.cloudDeviceId,
    appVersion: app.getVersion(),
    pollIntervalMs: settings.cloudPollIntervalMs,
    presenceIntervalMs: settings.cloudPresenceIntervalMs,
    telemetryEnabled: settings.cloudTelemetryEnabled,
    buildPresence: buildCloudPresence,
    onEvent(level, message, meta) {
      record(level, "cloud", message, meta);
    },
  });

  try {
    cloudBridgeState = await cloudBridge.start();
  } catch (error) {
    cloudBridgeState = {
      status: "error",
      running: false,
      lastErrorCode: error?.code ?? "CLOUD_BRIDGE_START_FAILED",
    };
    record("error", "cloud", "Cloud Bridge failed to start", {
      code: cloudBridgeState.lastErrorCode,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return cloudBridgeSnapshot();
}

async function probeCloud() {
  const settings = store.getSettings();
  if (!settings.cloudBaseUrl?.trim()) {
    throw new Error("OWL Cloud base URL is not configured.");
  }
  const client = new CloudHttpClient({
    baseUrl: settings.cloudBaseUrl,
  });
  return client.health();
}

function runtimeHostSupervisor() {
  const settings = store.getSettings();
  return new RuntimeHostSupervisor({
    runtimeBaseUrl: settings.runtimeBaseUrl,
    runtimeToken: runtimeToken(),
  });
}

function effectiveTunnelBinary(settings) {
  if (settings.tunnelBinaryPath?.trim()) {
    return settings.tunnelBinaryPath.trim();
  }
  if (!app.isPackaged) return "";
  const arch = process.arch === "x64" ? "x64" : "arm64";
  return path.join(
    process.resourcesPath,
    "owl-tunnel",
    arch,
    "tunnel-client-runtime",
  );
}

async function startTunnel() {
  const settings = store.getSettings();
  if (!settings.tunnelEnabled) {
    await tunnelSupervisor.stop();
    return tunnelSupervisor.status();
  }
  return tunnelSupervisor.start({
    binaryPath: effectiveTunnelBinary(settings),
    tunnelId: settings.tunnelId,
    apiKey: tunnelApiKey(),
    mcpUrl: `http://127.0.0.1:${settings.mcpPort}/mcp`,
  });
}

async function stopMcp() {
  if (mcpServer) {
    await mcpServer.close().catch(() => undefined);
    mcpServer = undefined;
  }
  mcpState = { status: "stopped", url: null, error: null };
}

async function startMcp() {
  const settings = store.getSettings();
  if (!settings.mcpEnabled) {
    await stopMcp();
    return mcpState;
  }

  await stopMcp();
  mcpState = { status: "starting", url: null, error: null };

  try {
    mcpServer = await startOwlMcpHttpServer({
      port: settings.mcpPort,
      runtimeBaseUrl: settings.runtimeBaseUrl,
      runtimeToken: runtimeToken(),
      mcpToken: mcpToken(),
      onEvent(level, message, meta) {
        record(level, "mcp", message, meta);
      },
    });
    mcpState = { status: "running", url: mcpServer.url, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mcpState = { status: "error", url: null, error: message };
    record("error", "mcp", "OWL MCP failed to start", { message });
  }
  return mcpState;
}

async function runtimeSnapshot() {
  const settings = store.getSettings();
  const client = runtimeClient();

  const started = Date.now();
  const [info, health, tasks, approvals, processes, diagnostics, host] =
    await Promise.allSettled([
      client.info(),
      client.health(),
      client.tasks(),
      client.approvals(),
      client.processes(),
      settings.diagnosticsEnabled ? client.diagnostics(40) : Promise.resolve(null),
      runtimeHostSupervisor().status(),
    ]);

  const online = info.status === "fulfilled";
  const result = {
    mode: online ? "live" : "offline",
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    info: info.status === "fulfilled" ? info.value : null,
    health: health.status === "fulfilled" ? health.value : null,
    tasks: tasks.status === "fulfilled" ? tasks.value : null,
    approvals: approvals.status === "fulfilled" ? approvals.value : null,
    processes: processes.status === "fulfilled" ? processes.value : null,
    diagnostics: diagnostics.status === "fulfilled" ? diagnostics.value : null,
    error: online ? null : (info.reason?.message ?? "OWL Runtime is unavailable"),
    metrics: {
      tasks: tasks.status === "fulfilled" ? collectionSize(tasks.value, ["tasks", "items"]) : 0,
      approvals: approvals.status === "fulfilled" ? collectionSize(approvals.value, ["approvals", "items"]) : 0,
      processes: processes.status === "fulfilled" ? collectionSize(processes.value, ["processes", "items"]) : 0,
    },
    mcp: {
      ...mcpState,
      ...(mcpServer?.snapshot() ?? { sessionCount: 0, sessions: [] }),
    },
    host: host.status === "fulfilled" ? host.value : null,
    tunnel: tunnelSupervisor?.status() ?? { state: "stopped" },
    cloud: cloudBridgeSnapshot(),
    accounts: identityVault?.list() ?? [],
    activity: activity.slice(0, 50),
  };

  record(
    online ? "info" : "warn",
    "runtime",
    online ? "Runtime snapshot refreshed" : "Runtime connection unavailable",
    { baseUrl: settings.runtimeBaseUrl, latencyMs: result.latencyMs },
  );
  result.activity = activity.slice(0, 50);
  return result;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: "#080a0c",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    mainWindow.loadURL("http://127.0.0.1:5173");
  }
}

function registerIpc() {
  ipcMain.handle("desktop:environment", () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
  }));

  ipcMain.handle("runtime:refresh", () => runtimeSnapshot());
  ipcMain.handle("cloud:status", () => cloudBridgeSnapshot());
  ipcMain.handle("cloud:probe", () => probeCloud());
  ipcMain.handle("cloud:start", () => startCloudBridge());
  ipcMain.handle("cloud:stop", () => stopCloudBridge());
  ipcMain.handle("cloud:sync", async () => {
    if (!cloudBridge) return await startCloudBridge();
    await cloudBridge.syncOnce({ forceHeartbeat: true });
    return cloudBridgeSnapshot();
  });
  ipcMain.handle("skills:snapshot", async () => {
    const started = Date.now();
    try {
      const snapshot = await skillManagerPort().snapshot();
      record("info", "skills", "Skill catalog refreshed", {
        skillCount: snapshot.skills.length,
        durationMs: Date.now() - started,
      });
      return snapshot;
    } catch (error) {
      record("error", "skills", "Skill catalog refresh failed", {
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  ipcMain.handle("skills:dry-run", async (_event, skillId, args) => {
    const started = Date.now();
    try {
      const result = await skillManagerPort().dryRun(skillId, args ?? {});
      record("info", "skills", "Skill dry run completed", {
        skillId,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      record("warn", "skills", "Skill dry run failed", {
        skillId,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  ipcMain.handle("skills:run", async (_event, skillId, args) => {
    const started = Date.now();
    try {
      const result = await skillManagerPort().run(skillId, args ?? {});
      record("info", "skills", "Skill run completed", {
        skillId,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      record("warn", "skills", "Skill run failed", {
        skillId,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  ipcMain.handle("host:status", () => runtimeHostSupervisor().status());
  ipcMain.handle("host:restart", () => runtimeHostSupervisor().restartService());
  ipcMain.handle("host:stop", () => runtimeHostSupervisor().stopService());
  ipcMain.handle("tunnel:status", () => tunnelSupervisor.status());
  ipcMain.handle("tunnel:start", () => startTunnel());
  ipcMain.handle("tunnel:stop", () => tunnelSupervisor.stop());
  ipcMain.handle("accounts:list", () => identityVault.list());
  ipcMain.handle("accounts:upsert", (_event, input) => identityVault.upsert(input));
  ipcMain.handle("accounts:delete", (_event, id) => identityVault.delete(id));
  ipcMain.handle("accounts:status", (_event, id, status, options) =>
    identityVault.markStatus(id, status, options));
  ipcMain.handle("accounts:capabilities", (_event, id) =>
    identityVault.capabilities(id));
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:update", async (_event, patch) => {
    const next = store.updateSettings(patch ?? {});
    if (typeof patch?.launchAtLogin === "boolean" && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin });
    }
    if (
      "runtimeBaseUrl" in (patch ?? {}) ||
      "mcpEnabled" in (patch ?? {}) ||
      "mcpPort" in (patch ?? {})
    ) {
      await startMcp();
    }
    if (
      "tunnelEnabled" in (patch ?? {}) ||
      "tunnelBinaryPath" in (patch ?? {}) ||
      "tunnelId" in (patch ?? {}) ||
      "mcpPort" in (patch ?? {})
    ) {
      if (next.tunnelEnabled) {
        await tunnelSupervisor.restart({
          binaryPath: effectiveTunnelBinary(next),
          tunnelId: next.tunnelId,
          apiKey: tunnelApiKey(),
          mcpUrl: `http://127.0.0.1:${next.mcpPort}/mcp`,
        }).catch((error) => {
          record("error", "tunnel", "Tunnel restart failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      } else {
        await tunnelSupervisor.stop();
      }
    }
    if (
      "cloudEnabled" in (patch ?? {}) ||
      "cloudBaseUrl" in (patch ?? {}) ||
      "cloudDeviceId" in (patch ?? {}) ||
      "cloudPollIntervalMs" in (patch ?? {}) ||
      "cloudPresenceIntervalMs" in (patch ?? {}) ||
      "cloudTelemetryEnabled" in (patch ?? {})
    ) {
      if (next.cloudEnabled) {
        await startCloudBridge();
      } else {
        await stopCloudBridge();
      }
    }
    record("info", "desktop", "Settings updated");
    return next;
  });
  ipcMain.handle("secrets:list", () => store.listSecrets());
  ipcMain.handle("secrets:upsert", async (_event, input) => {
    const meta = store.upsertSecret(input);
    record("info", "vault", `Secret saved: ${meta.name}`, { project: meta.project });
    if (
      meta.name === "OWL_RUNTIME_API_TOKEN" ||
      meta.name === "OWL_MCP_API_TOKEN"
    ) {
      await startMcp();
    }
    if (meta.name === "OWL_TUNNEL_API_KEY") {
      const settings = store.getSettings();
      if (settings.tunnelEnabled) {
        await tunnelSupervisor.restart({
          binaryPath: effectiveTunnelBinary(settings),
          tunnelId: settings.tunnelId,
          apiKey: tunnelApiKey(),
          mcpUrl: `http://127.0.0.1:${settings.mcpPort}/mcp`,
        });
      }
    }
    if (meta.name === "OWL_CLOUD_DEVICE_CREDENTIAL") {
      const settings = store.getSettings();
      if (settings.cloudEnabled) await startCloudBridge();
    }
    return meta;
  });
  ipcMain.handle("secrets:delete", async (_event, id) => {
    const existing = store.listSecrets().find((secret) => secret.id === id);
    const result = store.deleteSecret(id);
    record("warn", "vault", "Secret removed", { id });
    if (
      existing?.name === "OWL_RUNTIME_API_TOKEN" ||
      existing?.name === "OWL_MCP_API_TOKEN"
    ) {
      await startMcp();
    }
    if (existing?.name === "OWL_TUNNEL_API_KEY") {
      await tunnelSupervisor.stop();
    }
    if (existing?.name === "OWL_CLOUD_DEVICE_CREDENTIAL") {
      await stopCloudBridge();
    }
    return result;
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    store = new DesktopStore();
    identityVault = new IdentityVault();
    cloudBridgeStore = new CloudBridgeStore({
      file: path.join(app.getPath("userData"), "cloud-bridge-state.json"),
    });
    tunnelSupervisor = new TunnelSupervisor({
      onEvent(level, message, meta) {
        record(level, "tunnel", message, meta);
      },
    });
    registerIpc();
    record("info", "desktop", "OWL Desktop started", { version: app.getVersion() });
    await startMcp();
    const settings = store.getSettings();
    if (settings.tunnelEnabled && settings.tunnelAutoStart) {
      await startTunnel().catch((error) => {
        record("error", "tunnel", "Tunnel auto-start failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
    if (settings.cloudEnabled && settings.cloudAutoStart) {
      await startCloudBridge().catch((error) => {
        record("error", "cloud", "Cloud Bridge auto-start failed", {
          code: error?.code ?? null,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    void cloudBridge?.stop();
    void tunnelSupervisor?.stop();
    void stopMcp();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
