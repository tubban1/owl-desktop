#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownerMatches, readDevOwner } from "./lib/dev-full-owner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2] || "status";
if (!["status", "stop", "restart"].includes(action)) {
  console.error("Usage: node scripts/dev-full-control.mjs status|stop|restart");
  process.exit(2);
}
const owner = readDevOwner();
if (!ownerMatches(owner, root)) {
  console.log("[dev:full] No verified owned supervisor. Refusing to signal unknown processes.");
  process.exit(action === "status" ? 0 : 1);
}
console.log("[dev:full] Verified supervisor PID " + owner.pid);
if (action === "status") process.exit(0);
process.kill(owner.pid, "SIGTERM");
console.log("[dev:full] Graceful stop requested. Wait for ports to be released.");
if (action === "restart") {
  console.log("[dev:full] After shutdown, run npm run dev:full in your terminal. Automatic detach/relaunch is intentionally disabled.");
}
