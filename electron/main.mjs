import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { DesktopStore } from "./store.mjs";
import { RuntimeHttpClient } from "./runtime-http-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let store;
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

async function runtimeSnapshot() {
  const settings = store.getSettings();
  const token =
    store.readSecret("OWL_RUNTIME_API_TOKEN", "owl-runtime") ??
    store.readSecret("OWL_RUNTIME_API_TOKEN");
  const client = new RuntimeHttpClient({
    baseUrl: settings.runtimeBaseUrl,
    sessionId: settings.sessionId,
    token,
  });

  const started = Date.now();
  const [info, health, tasks, approvals, processes, diagnostics] =
    await Promise.allSettled([
      client.info(),
      client.health(),
      client.tasks(),
      client.approvals(),
      client.processes(),
      settings.diagnosticsEnabled ? client.diagnostics(40) : Promise.resolve(null),
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
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:update", (_event, patch) => {
    const next = store.updateSettings(patch ?? {});
    if (typeof patch?.launchAtLogin === "boolean" && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin });
    }
    record("info", "desktop", "Settings updated");
    return next;
  });
  ipcMain.handle("secrets:list", () => store.listSecrets());
  ipcMain.handle("secrets:upsert", (_event, input) => {
    const meta = store.upsertSecret(input);
    record("info", "vault", `Secret saved: ${meta.name}`, { project: meta.project });
    return meta;
  });
  ipcMain.handle("secrets:delete", (_event, id) => {
    const result = store.deleteSecret(id);
    record("warn", "vault", "Secret removed", { id });
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

  app.whenReady().then(() => {
    store = new DesktopStore();
    registerIpc();
    record("info", "desktop", "OWL Desktop started", { version: app.getVersion() });
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
