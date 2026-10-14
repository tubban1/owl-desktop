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
    oauthCipherText: _oauthCipherText,
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
    // An edit must not silently become a new record if its ID was deleted.
    if(id && !previous)throw Error("ACCOUNT_EDIT_NOT_FOUND");
    const now = new Date().toISOString();

    if (secret && !safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "OS-backed encryption is unavailable; refusing credential storage.",
      );
    }

    const sameIdentity = previous && previous.service === service.trim() &&
      previous.identifier === identifier.trim() && previous.authMethod === authMethod;
    const record = {
      id: previous?.id ?? id ?? randomUUID(),
      service: service.trim(),
      label: label.trim(),
      identifier: identifier.trim(),
      authMethod,
      status: sameIdentity ? previous?.status ?? "needs_login" : "needs_login",
      browserProfileId:
        browserProfileId ?? (sameIdentity ? previous?.browserProfileId ?? null : null),
      notes: notes.trim(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastAuthenticatedAt: sameIdentity ? previous?.lastAuthenticatedAt ?? null : null,
      expiresAt: sameIdentity ? previous?.expiresAt ?? null : null,
      // Do not retain secrets/sessions when the owner, platform or auth method
      // changes. Label-only edits preserve existing credentials.
      cipherText: secret
        ? safeStorage.encryptString(secret).toString("base64")
        : sameIdentity ? previous?.cipherText ?? null : null,
      refreshCipherText: sameIdentity ? previous?.refreshCipherText ?? null : null,
      recoveryCipherText: sameIdentity ? previous?.recoveryCipherText ?? null : null,
      oauthCipherText: sameIdentity ? previous?.oauthCipherText ?? null : null,
      connectedProvider: sameIdentity ? previous?.connectedProvider ?? null : null,
      connectedTargetId: sameIdentity ? previous?.connectedTargetId ?? null : null,
      connectedTargetTitle: sameIdentity ? previous?.connectedTargetTitle ?? null : null,
      connectedClientId: sameIdentity ? previous?.connectedClientId ?? null : null,
      verifiedEmail: sameIdentity ? previous?.verifiedEmail ?? null : null,
      lastYoutubeOauthError: sameIdentity ? previous?.lastYoutubeOauthError ?? null : null,
      lastYoutubeOauthErrorAt: sameIdentity ? previous?.lastYoutubeOauthErrorAt ?? null : null,
      lastInstagramOauthError: sameIdentity ? previous?.lastInstagramOauthError ?? null : null,
      lastInstagramOauthErrorAt: sameIdentity ? previous?.lastInstagramOauthErrorAt ?? null : null,
    };
    if (!sameIdentity && previous?.oauthCipherText) {
      record.status = "needs_login";
      record.lastAuthenticatedAt = null;
      record.expiresAt = null;
    }

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

  noteYoutubeOauthAttempt(id, errorCode = null) {
    const records=readJson(this.file,[]);
    const index=records.findIndex(item=>item.id===id);
    if(index<0)throw Error("YOUTUBE_ACCOUNT_RECORD_NOT_FOUND");
    if(!["google","youtube"].includes(records[index].service?.toLowerCase().trim()))
      throw Error("YOUTUBE_WRONG_SERVICE");
    const safeError=errorCode===null?null:
      /^YOUTUBE_OAUTH_[A-Z0-9_]{1,80}$/.test(errorCode)
        ? errorCode : "YOUTUBE_OAUTH_CONNECTION_FAILED";
    records[index]={...records[index],
      lastYoutubeOauthError:safeError,
      lastYoutubeOauthErrorAt:safeError?new Date().toISOString():null,
      updatedAt:new Date().toISOString(),
    };
    writeJson(this.file,records);
    return sanitize(records[index]);
  }

  noteInstagramOauthAttempt(id, errorCode=null){
    const records=readJson(this.file,[]);
    const index=records.findIndex(item=>item.id===id);
    if(index<0||records[index].service?.trim().toLowerCase()!=="instagram")
      throw Error("INSTAGRAM_ACCOUNT_NOT_FOUND");
    const safe=errorCode===null?null:
      /^INSTAGRAM_OAUTH_[A-Z0-9_]{1,80}$/.test(errorCode)
       ?errorCode:"INSTAGRAM_OAUTH_CONNECTION_FAILED";
    records[index]={...records[index],lastInstagramOauthError:safe,
      lastInstagramOauthErrorAt:safe?new Date().toISOString():null,
      updatedAt:new Date().toISOString()};
    writeJson(this.file,records);
    return sanitize(records[index]);
  }
  saveInstagramGrant(id,verified,appId){
    const rows=readJson(this.file,[]);
    const index=rows.findIndex(item=>item.id===id);
    if(index<0||rows[index].service?.trim().toLowerCase()!=="instagram")
      throw Error("INSTAGRAM_ACCOUNT_NOT_FOUND");
    if(!safeStorage.isEncryptionAvailable())throw Error("INSTAGRAM_OS_SECURE_STORAGE_UNAVAILABLE");
    if(!/^[0-9]{6,30}$/.test(appId)||!/^[0-9]{4,32}$/.test(verified?.accountId??"")||
      !verified?.grant?.accessToken||!verified?.grant?.expiresAt)
      throw Error("INSTAGRAM_GRANT_INVALID");
    const current=rows[index];
    const requested=current.identifier.trim().replace(/^@/,"").toLowerCase();
    if(requested && requested!==verified.username.toLowerCase())
      throw Error("INSTAGRAM_OAUTH_WRONG_ACCOUNT");
    rows[index]={...current,status:"ready",authMethod:"oauth",
      connectedProvider:"instagram",connectedTargetId:verified.accountId,
      connectedTargetTitle:"@"+verified.username,connectedClientId:appId,
      lastInstagramOauthError:null,lastInstagramOauthErrorAt:null,
      lastAuthenticatedAt:new Date().toISOString(),
      expiresAt:verified.grant.expiresAt,
      cipherText:null,oauthCipherText:safeStorage.encryptString(
       JSON.stringify(verified.grant)).toString("base64"),
      updatedAt:new Date().toISOString()};
    writeJson(this.file,rows);
    return sanitize(rows[index]);
  }

  saveYoutubeGrant(id, verified, clientId) {
    const records = readJson(this.file, []);
    const index = records.findIndex(item => item.id === id);
    if(index<0)throw Error("YOUTUBE_ACCOUNT_RECORD_NOT_FOUND");
    if(!["google","youtube"].includes(records[index].service.toLowerCase().trim()))
      throw Error("YOUTUBE_WRONG_SERVICE");
    if(!safeStorage.isEncryptionAvailable())
      throw Error("YOUTUBE_OS_SECURE_STORAGE_UNAVAILABLE");
    if(!/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))
      throw Error("YOUTUBE_CLIENT_ID_INVALID");
    if(!/^UC[A-Za-z0-9_-]{22}$/.test(verified.channelId) ||
       !verified.grant?.refreshToken || !verified.grant?.accessToken)
      throw Error("YOUTUBE_GRANT_INVALID");
    const record=records[index];
    records[index]={...record,
      status:"ready",authMethod:"oauth",connectedProvider:"youtube",
      connectedTargetId:verified.channelId,connectedTargetTitle:verified.channelTitle,
      verifiedEmail:verified.verifiedEmail,
      connectedClientId:clientId,
      lastYoutubeOauthError:null,lastYoutubeOauthErrorAt:null,
      lastAuthenticatedAt:new Date().toISOString(),
      expiresAt:verified.grant.expiresAt,updatedAt:new Date().toISOString(),
      cipherText:null,
      oauthCipherText:safeStorage.encryptString(JSON.stringify(verified.grant)).toString("base64"),
    };
    writeJson(this.file,records);
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
