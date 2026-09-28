import fs from "node:fs";
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
  constructor() {
    this.settingsFile = path.join(app.getPath("userData"), "settings.json");
    this.secretsFile = path.join(app.getPath("userData"), "secrets.json");
  }

  getSettings() {
    const stored = readJson(this.settingsFile, {});
    const settings = {
      runtimeBaseUrl: "http://127.0.0.1:8788",
      autoConnectRuntime: true,
      launchAtLogin: false,
      diagnosticsEnabled: true,
      sessionId: stored.sessionId || `owl-desktop:${randomUUID()}`,
      ...stored,
    };
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
