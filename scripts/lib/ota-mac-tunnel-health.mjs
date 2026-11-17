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

// Redacted, read-only evidence for failed guarded rollout. This deliberately
// does not expose full commands, Cloud tunnel IDs, file paths, health URLs,
// tokens or file contents. Acceptance is still governed EXCLUSIVELY by
// macOwnedTunnelHealthUrl() above.
export function macOwnedTunnelHealthDiagnostics(input) {
  const result = {
    hostCount: 0, childCount: 0, ownedHealthUrlAccepted: false,
    healthFilePresent: false, healthFileNameMatched: false,
    healthFilePermissionMatched: false, reason: "invalid-input",
  };
  const {releaseRoot, processTable,
    tempDir = path.join(os.tmpdir(), "owl-desktop-tunnel"),
    uid = typeof process.getuid === "function" ? process.getuid() : null,
    fileSystem = fs} = input ?? {};
  if (typeof releaseRoot !== "string" || !path.isAbsolute(releaseRoot) ||
      typeof processTable !== "string" || !Number.isInteger(uid)) return result;
  const hostScript = path.join(releaseRoot,"connection-host","server.mjs");
  const rows = processTable.split(/\r?\n/).map(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return m ? {pid:Number(m[1]),ppid:Number(m[2]),command:m[3]} : null;
  }).filter(Boolean);
  const hosts = rows.filter(row => row.pid>1 && row.ppid>0 &&
    new RegExp("^(?:\\S*[/\\\\])?node(?:\\s+--[^\\s]+)*\\s+"+
      escapeRe(hostScript)+"(?:\\s|$)").test(row.command));
  result.hostCount=hosts.length;
  if(hosts.length!==1){result.reason="host-count";return result;}
  const hostPid=hosts[0].pid;
  const clients=rows.filter(row => row.ppid===hostPid && row.pid>1 &&
    /(?:^|\/)tunnel-client-runtime\s+run\s/.test(row.command) &&
    /(?:^|\s)--mcp\.server-url\s+url=http:\/\/127\.0\.0\.1:8790\/mcp(?:\s|$)/.test(row.command) &&
    /(?:^|\s)--control-plane\.tunnel-id\s+\S+/.test(row.command) &&
    /(?:^|\s)--health\.url-file\s+\S+/.test(row.command));
  result.childCount=clients.length;
  if(clients.length!==1){result.reason="child-count";return result;}
  const filename=/(?:^|\s)--health\.url-file\s+(\S+)(?:\s|$)/.exec(clients[0].command)?.[1];
  if(!filename || !path.isAbsolute(filename)){result.reason="health-file-path";return result;}
  try {
    const canonicalDir=fileSystem.realpathSync(tempDir);
    const canonicalFile=fileSystem.realpathSync(filename);
    result.healthFilePresent=true;
    result.healthFileNameMatched=path.dirname(canonicalFile)===canonicalDir &&
      path.basename(canonicalFile).startsWith("health-url-"+hostPid+"-") &&
      path.basename(canonicalFile).endsWith(".txt");
    const stat=fileSystem.lstatSync(filename);
    result.healthFilePermissionMatched=stat.isFile() && !stat.isSymbolicLink() &&
      stat.uid===uid && (stat.mode & 0o077)===0 && stat.size<=128;
  } catch {result.reason="health-file-missing-or-unreadable";return result;}
  result.ownedHealthUrlAccepted=Boolean(macOwnedTunnelHealthUrl(input));
  result.reason=result.ownedHealthUrlAccepted?"owned-url-accepted":
    !result.healthFileNameMatched?"health-file-ownership":
    !result.healthFilePermissionMatched?"health-file-permissions":"invalid-health-url";
  return result;
}
