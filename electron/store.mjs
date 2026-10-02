import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, safeStorage } from "electron";

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
};

export class DesktopStore {
  constructor({ root } = {}) {
    const userDataRoot = root ? path.resolve(root) : app.getPath("userData");
    this.settingsFile = path.join(userDataRoot, "settings.json");
    this.secretsFile = path.join(userDataRoot, "secrets.json");
  }

  getSettings() {
    const stored = readJson(this.settingsFile, {});
    const standardFolders = [
      path.join(os.homedir(), "Desktop"),
      path.join(os.homedir(), "Documents"),
      path.join(os.homedir(), "Downloads"),
    ].filter((candidate) => fs.existsSync(candidate));
    const settings = {
      wakeName: "OWL",
      wakeAliases: ["OWL Runtime", "AgentOS"],
      allowedDirectories: standardFolders,
      runtimeBaseUrl: "http://127.0.0.1:8788",
      autoConnectRuntime: true,
      mcpEnabled: true,
      mcpPort: 8790,
      tunnelEnabled: false,
      tunnelAutoStart: false,
      tunnelBinaryPath: "",
      tunnelId: "",
      connectivityMode:
        stored.connectivityMode ||
        (stored.tunnelEnabled === true && String(stored.tunnelId || "").trim()
          ? "custom_tunnel"
          : "cloud_durable"),
      cloudEnabled: false,
      cloudAutoStart: false,
      cloudBaseUrl:
        process.env.OWL_CLOUD_BASE_URL?.trim() ||
        "https://yh9cjtolx6.execute-api.eu-central-1.amazonaws.com",
      cloudDeviceId: "",
      cloudPollIntervalMs: 5000,
      cloudPresenceIntervalMs: 30000,
      cloudTelemetryEnabled: true,
      launchAtLogin: false,
      diagnosticsEnabled: true,
      sessionId: stored.sessionId || `owl-desktop:${randomUUID()}`,
      ...stored,
    };
    settings.wakeName =
      typeof settings.wakeName === "string" && settings.wakeName.trim()
        ? settings.wakeName.trim().slice(0, 64)
        : "OWL";
    settings.wakeAliases = Array.isArray(settings.wakeAliases)
      ? [...new Set(
          settings.wakeAliases
            .filter((value) => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean),
        )].slice(0, 12)
      : [];
    settings.allowedDirectories = Array.isArray(settings.allowedDirectories)
      ? [...new Set(
          settings.allowedDirectories
            .filter((value) => typeof value === "string")
            .map((value) => path.resolve(value))
            .filter((value) => fs.existsSync(value)),
        )]
      : standardFolders;
    if (!stored.sessionId) writeJson(this.settingsFile, settings);
    return settings;
  }

  updateSettings(patch) {
    const next = { ...this.getSettings(), ...patch };
    writeJson(this.settingsFile, next);
    return next;
  }

  listSecrets() {
    const records = readJson(this.secretsFile, []);
    return records.map(({ cipherText, ...meta }) => meta);
  }

  upsertSecret({ id, name, project, value }) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS-backed encryption is not available; refusing plaintext secret storage.");
    }
    const records = readJson(this.secretsFile, []);
    const now = new Date().toISOString();
    const existingIndex = records.findIndex((entry) => entry.id === id || (entry.name === name && entry.project === project));
    const previous = existingIndex >= 0 ? records[existingIndex] : null;
    const record = {
      id: previous?.id || id || randomUUID(),
      name: name.trim(),
      project: project.trim() || "global",
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      cipherText: safeStorage.encryptString(value).toString("base64"),
    };
    if (existingIndex >= 0) records[existingIndex] = record;
    else records.push(record);
    writeJson(this.secretsFile, records);
    const { cipherText, ...meta } = record;
    return meta;
  }

  deleteSecret(id) {
    const records = readJson(this.secretsFile, []);
    writeJson(this.secretsFile, records.filter((entry) => entry.id !== id));
    return { ok: true };
  }

  readSecret(name, project) {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    const records = readJson(this.secretsFile, []);
    const record = records.find((entry) => entry.name === name && (!project || entry.project === project));
    if (!record) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(record.cipherText, "base64"));
    } catch {
      return undefined;
    }
  }
}
