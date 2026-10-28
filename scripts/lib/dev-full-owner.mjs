import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const devFullOwnerFile = path.join(os.homedir(), ".owl-lab", "dev-full-owner.json");

export function processBirth(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch { return null; }
}

export function ownerMatches(record, expectedRoot) {
  if (!record || record.version !== 1 || record.desktopRoot !== expectedRoot ||
      !Number.isSafeInteger(record.pid) || record.pid <= 1 ||
      typeof record.birth !== "string" || !record.birth) return false;
  if (processBirth(record.pid) !== record.birth) return false;
  try {
    const command = execFileSync("ps", ["-p", String(record.pid), "-o", "command="], {
      encoding: "utf8", timeout: 2000,
    }).trim();
    return command.includes(path.join(expectedRoot, "scripts", "dev-full.mjs"));
  } catch { return false; }
}

export function readDevOwner(file = devFullOwnerFile) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

export function writeDevOwner(root, file = devFullOwnerFile) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const existing = readDevOwner(file);
  if (existing?.pid !== process.pid && ownerMatches(existing, existing?.desktopRoot)) {
    throw new Error("Another owned dev:full supervisor is already running (PID " + existing.pid + ").");
  }
  const record = { version: 1, desktopRoot: root, pid: process.pid, birth: processBirth(process.pid) };
  if (!record.birth) throw new Error("Cannot verify dev:full process identity.");
  fs.writeFileSync(file, JSON.stringify(record) + "\n", { mode: 0o600 });
  return record;
}

export function removeDevOwner(record, file = devFullOwnerFile) {
  const current = readDevOwner(file);
  if (current?.pid === record?.pid && current?.birth === record?.birth) {
    try { fs.unlinkSync(file); } catch {}
  }
}
