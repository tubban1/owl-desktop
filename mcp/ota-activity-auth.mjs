// A dedicated, local-only OTA observation credential. Never reuse the
// sensitive normal MCP token or expose task/approval payloads.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";

export function otaActivityTokenPath() {
  return path.join(os.homedir(), ".owl-lab", "version-sync",
    "desktop", "ota", "activity-token");
}

export function readOtaActivityToken() {
  try {
    const file=otaActivityTokenPath();
    const stat=fs.statSync(file);
    if (!stat.isFile() || (process.platform!=="win32" && (stat.mode & 0o077)))
      return null;
    const token=fs.readFileSync(file,"utf8").trim();
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  } catch {return null;}
}

export function validLocalOtaRequest(req,token) {
  if(typeof token!=="string"|| !/^[A-Za-z0-9_-]{43}$/.test(token))
    return false;
  const addr=req.socket?.remoteAddress;
  if(addr!=="127.0.0.1"&&addr!=="::1"&&addr!=="::ffff:127.0.0.1")
    return false;
  const raw=req.headers?.["x-owl-ota-activity-token"];
  if(typeof raw!=="string"|| !/^[A-Za-z0-9_-]{43}$/.test(raw))
    return false;
  return timingSafeEqual(Buffer.from(raw,"utf8"),Buffer.from(token,"utf8"));
}
