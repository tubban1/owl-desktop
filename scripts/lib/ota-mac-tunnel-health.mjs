import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The Desktop Connection Host owns the tunnel child. In DEV mode the binary
// can be shared with a source checkout rather than copied under _releases.
// Never equate tunnel executable path with release ownership.
//
// This is a read-only discovery function: no socket listener, no tunnel
// restart, no kill, no credentials, no release mutation.
export function macOwnedTunnelHealthUrl({
  releaseRoot,
  processTable,
  tempDir = path.join(os.tmpdir(), "owl-desktop-tunnel"),
  uid = typeof process.getuid === "function" ? process.getuid() : null,
  fileSystem = fs,
}) {
  if (typeof releaseRoot !== "string" || !path.isAbsolute(releaseRoot) ||
      typeof processTable !== "string" || !Number.isInteger(uid)) return null;

  const hostScript = path.join(releaseRoot, "connection-host", "server.mjs");
  const rows = processTable.split(/\r?\n/).map(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] } : null;
  }).filter(Boolean);

  // Require one independently identified Connection Host for this release.
  // Avoid substring spoofing from an unrelated script/command or another
  // version's Host.
  const hosts = rows.filter(row =>
    row.pid > 1 && row.ppid > 0 &&
    new RegExp("^(?:\\S*[/\\\\])?node(?:\\s+--[^\\s]+)*\\s+" +
      escapeRe(hostScript) + "(?:\\s|$)").test(row.command));
  if (hosts.length !== 1) return null;
  const hostPid = hosts[0].pid;

  const clients = rows.filter(row =>
    row.ppid === hostPid && row.pid > 1 &&
    /(?:^|\/)tunnel-client-runtime\s+run\s/.test(row.command) &&
    /(?:^|\s)--mcp\.server-url\s+url=http:\/\/127\.0\.0\.1:8790\/mcp(?:\s|$)/.test(row.command) &&
    /(?:^|\s)--control-plane\.tunnel-id\s+\S+/.test(row.command) &&
    /(?:^|\s)--health\.url-file\s+\S+/.test(row.command));
  if (clients.length !== 1) return null;

  const match = /(?:^|\s)--health\.url-file\s+(\S+)(?:\s|$)/.exec(clients[0].command);
  const healthFile = match?.[1];
  if (!healthFile || !path.isAbsolute(healthFile)) return null;

  try {
    const trustedDir = fileSystem.realpathSync(tempDir);
    const resolved = fileSystem.realpathSync(healthFile);
    if (path.dirname(resolved) !== trustedDir ||
        !path.basename(resolved).startsWith("health-url-" + hostPid + "-") ||
        !path.basename(resolved).endsWith(".txt")) return null;

    const stat = fileSystem.lstatSync(healthFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid ||
        (stat.mode & 0o077) !== 0 || stat.size > 128) return null;
    const url = fileSystem.readFileSync(healthFile, "utf8").trim();
    const urlParts = /^http:\/\/127\.0\.0\.1:(\d{2,5})\/?$/.exec(url);
    const port = Number(urlParts?.[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return "http://127.0.0.1:" + port + "/health?details=true";
  } catch { return null; }
}
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
