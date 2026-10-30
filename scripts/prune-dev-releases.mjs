#!/usr/bin/env node
// Retire inactive superseded dev-release services and duplicate snapshots.
// Default: dry run. --apply only operates under the known _releases directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const root = path.resolve(import.meta.dirname, "../../_releases");
const agentsRoot = path.join(os.homedir(), "Library/LaunchAgents");
const archiveRoot = path.join(os.homedir(), ".owl-lab", "release-prune-archive",
  new Date().toISOString().replace(/[:.]/g, "-"));
const folders = fs.readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^owl-desktop-[0-9a-f]{7}$/.test(entry.name))
  .map(entry => ({
    name: entry.name,
    root: path.join(root, entry.name),
    mtimeMs: fs.statSync(path.join(root, entry.name)).mtimeMs,
  })).sort((a, b) => b.mtimeMs - a.mtimeMs);

function readCommand(file, args) {
  try { return execFileSync(file, args, { encoding: "utf8", timeout: 8000 }); }
  catch (error) { throw new Error(file + " failed: " + error.message); }
}
const running = readCommand("/bin/ps", ["-Ao", "command="]);
const loaded = new Map(
  readCommand("/bin/launchctl", ["list"]).split("\n").slice(1)
    .map(line => line.trim().split(/\s+/))
    .filter(fields => fields.length === 3)
    .map(([pid, , label]) => [label, pid]),
);
const agentFiles = fs.readdirSync(agentsRoot)
  .filter(name => name.startsWith("fan.fde.owl.dev-release.")
    || name.startsWith("fan.fde.owl.rollout."))
  .map(name => {
    const full = path.join(agentsRoot, name);
    const text = fs.readFileSync(full, "utf8");
    const label = text.match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
    return { name, full, text, label };
  });

// Keep latest 3 snapshots, active-process references, and any service
// currently running, with its direct fallback/watchdog for safe rollback.
const retained = new Set(folders.slice(0, 3).map(entry => entry.name));
for (const entry of folders) if (running.includes(entry.root)) retained.add(entry.name);
const currentLabels = new Set([...loaded.entries()]
  .filter(([, pid]) => pid !== "-").map(([label]) => label));
const protectedAgents = new Set(agentFiles
  .filter(agent => currentLabels.has(agent.label))
  .map(agent => agent.full));
for (const agent of agentFiles) {
  if (!protectedAgents.has(agent.full)) continue;
  for (const entry of folders) {
    if (agent.text.includes(entry.root)) retained.add(entry.name);
  }
}
const currentLabel = [...currentLabels].find(label =>
  label.startsWith("fan.fde.owl.dev-release.") && label.endsWith(".current"));
if (currentLabel) {
  const prefix = currentLabel.replace(/\.current$/, "");
  for (const agent of agentFiles) {
    if (agent.label === prefix + ".fallback" || agent.label === prefix + ".watchdog") {
      protectedAgents.add(agent.full);
      for (const entry of folders) {
        if (agent.text.includes(entry.root)) retained.add(entry.name);
      }
    }
  }
}

const retiringAgents = agentFiles.filter(agent =>
  !protectedAgents.has(agent.full) && !currentLabels.has(agent.label));
const remainingConfig = agentFiles.filter(agent =>
  protectedAgents.has(agent.full) || currentLabels.has(agent.label));
const deletable = folders.filter(entry => !retained.has(entry.name)
  && !remainingConfig.some(config => config.text.includes(entry.root)));

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  retained: [...retained].sort(),
  plannedRetireAgentCount: retiringAgents.length,
  plannedRemove: deletable.map(({ name }) => name),
}, null, 2));
if (!apply) process.exit(0);

fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
const safelyRetired = [];
for (const agent of retiringAgents) {
  const pid = agent.label ? loaded.get(agent.label) : undefined;
  if (pid && pid !== "-") continue;
  if (pid) {
    try {
      execFileSync("/bin/launchctl",
        ["bootout", "gui/" + process.getuid() + "/" + agent.label],
        { encoding: "utf8", timeout: 8000, stdio: "pipe" });
    } catch (error) {
      console.error("Skipping still-loaded agent:", agent.label, error.message);
      continue;
    }
  }
  fs.renameSync(agent.full, path.join(archiveRoot, agent.name));
  safelyRetired.push(agent.name);
}
// Recheck live references after agent retirement; never remove a running
// release or a path referenced by any remaining active configuration.
const remainingAgentsText = fs.readdirSync(agentsRoot)
  .filter(name => name.includes("owl"))
  .map(name => {
    try { return fs.readFileSync(path.join(agentsRoot, name), "utf8"); }
    catch { return ""; }
  }).join("\n");
const freshProcesses = readCommand("/bin/ps", ["-Ao", "command="]);
const removed = [];
for (const entry of deletable) {
  if (freshProcesses.includes(entry.root) || remainingAgentsText.includes(entry.root)) continue;
  if (!fs.existsSync(entry.root) || fs.lstatSync(entry.root).isSymbolicLink()) continue;
  fs.rmSync(entry.root, { recursive: true });
  removed.push(entry.name);
}
fs.writeFileSync(path.join(archiveRoot, "receipt.json"), JSON.stringify({
  removed, safelyRetired, retained: [...retained],
  performedAt: new Date().toISOString(),
}, null, 2));
console.log(JSON.stringify({
  removed, retiredAgentCount: safelyRetired.length,
  archivedAgentConfigAt: archiveRoot,
}, null, 2));
