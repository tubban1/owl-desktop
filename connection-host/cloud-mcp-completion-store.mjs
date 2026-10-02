import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

function keyFor(callId) {
  return createHash("sha256").update(String(callId), "utf8").digest("hex");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export class CloudMcpCompletionStore {
  constructor({ root }) {
    if (!root) throw new Error("CloudMcpCompletionStore requires root.");
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  fileFor(callId) {
    return path.join(this.root, `${keyFor(callId)}.json`);
  }
  get(callId) {
    const value = readJson(this.fileFor(callId));
    if (!value || value.callId !== callId) return null;
    return value;
  }

  put(callId, { requestDigest = null, payload }) {
    const record = {
      callId,
      requestDigest,
      payload,
      savedAt: new Date().toISOString(),
    };
    const file = this.fileFor(callId);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const encoded = JSON.stringify(record);
    fs.writeFileSync(temporary, encoded, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporary, file);
    return record;
  }

  delete(callId) {
    try {
      fs.unlinkSync(this.fileFor(callId));
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  snapshot() {
    let pending = 0;
    try {
      pending = fs.readdirSync(this.root).filter((name) => name.endsWith(".json")).length;
    } catch {}
    return { root: this.root, pending };
  }
}
