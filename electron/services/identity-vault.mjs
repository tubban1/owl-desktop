import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, safeStorage } from "electron";
import { assertLoginTransition } from "./login-challenge.mjs";

const AUTH_METHODS = new Set([
  "password",
  "oauth",
  "third_party_oauth",
  "qr",
  "sms_otp",
  "email_otp",
  "totp",
  "authenticator_push",
  "passkey",
  "device_code",
  "native_app_session",
]);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function sanitize(record) {
  const {
    cipherText: _cipherText,
    refreshCipherText: _refreshCipherText,
    recoveryCipherText: _recoveryCipherText,
    ...meta
  } = record;
  return meta;
}

export class IdentityVault {
  constructor({ file } = {}) {
    this.file =
      file ?? path.join(app.getPath("userData"), "identity-accounts.json");
  }

  list() {
    return readJson(this.file, []).map(sanitize);
  }

  get(id) {
    const record = readJson(this.file, []).find((item) => item.id === id);
    return record ? sanitize(record) : null;
  }

  upsert({
    id,
    service,
    label,
    identifier = "",
    authMethod,
    secret,
    browserProfileId = null,
    notes = "",
  }) {
    if (!service?.trim()) throw new Error("Service is required.");
    if (!label?.trim()) throw new Error("Account label is required.");
    if (!AUTH_METHODS.has(authMethod)) {
      throw new Error(`Unsupported auth method: ${authMethod}`);
    }

    const records = readJson(this.file, []);
    const index = records.findIndex((item) => item.id === id);
    const previous = index >= 0 ? records[index] : null;
    const now = new Date().toISOString();

    if (secret && !safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "OS-backed encryption is unavailable; refusing credential storage.",
      );
    }

    const record = {
      id: previous?.id ?? id ?? randomUUID(),
      service: service.trim(),
      label: label.trim(),
      identifier: identifier.trim(),
      authMethod,
      status: previous?.status ?? "needs_login",
      browserProfileId:
        browserProfileId ?? previous?.browserProfileId ?? null,
      notes: notes.trim(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastAuthenticatedAt: previous?.lastAuthenticatedAt ?? null,
      expiresAt: previous?.expiresAt ?? null,
      cipherText: secret
        ? safeStorage.encryptString(secret).toString("base64")
        : previous?.cipherText ?? null,
      refreshCipherText: previous?.refreshCipherText ?? null,
      recoveryCipherText: previous?.recoveryCipherText ?? null,
    };

    if (index >= 0) records[index] = record;
    else records.push(record);
    writeJson(this.file, records);
    return sanitize(record);
  }

  delete(id) {
    const records = readJson(this.file, []);
    writeJson(this.file, records.filter((item) => item.id !== id));
    return { ok: true };
  }

  markStatus(id, status, { expiresAt = null } = {}) {
    const records = readJson(this.file, []);
    const index = records.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("Account not found.");
    assertLoginTransition(records[index].status, status);
    records[index] = {
      ...records[index],
      status,
      updatedAt: new Date().toISOString(),
      lastAuthenticatedAt:
        status === "ready"
          ? new Date().toISOString()
          : records[index].lastAuthenticatedAt ?? null,
      expiresAt,
    };
    writeJson(this.file, records);
    return sanitize(records[index]);
  }

  readSecret(id) {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    const record = readJson(this.file, []).find((item) => item.id === id);
    if (!record?.cipherText) return undefined;
    try {
      return safeStorage.decryptString(
        Buffer.from(record.cipherText, "base64"),
      );
    } catch {
      return undefined;
    }
  }

  capabilities(id) {
    const record = readJson(this.file, []).find((item) => item.id === id);
    if (!record) return null;
    const interactive = new Set([
      "qr",
      "sms_otp",
      "email_otp",
      "authenticator_push",
      "passkey",
      "device_code",
    ]);
    return {
      canProvideStoredSecret: Boolean(record.cipherText),
      requiresHumanChallenge: interactive.has(record.authMethod),
      browserSessionPreferred: [
        "oauth",
        "third_party_oauth",
        "qr",
        "passkey",
      ].includes(record.authMethod),
      nativeSessionPreferred:
        record.authMethod === "native_app_session",
    };
  }
}

export const identityAuthMethods = [...AUTH_METHODS];
