#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.resolve(
  process.env.OWL_RUNTIME_REPO || path.join(desktopRoot, "..", "owl-runtime"),
);
const contract = JSON.parse(
  fs.readFileSync(
    path.join(desktopRoot, "docs/contracts/OWL_RUNTIME_COMPONENT_V1.json"),
    "utf8",
  ),
);
const source = path.join(runtimeRoot, "macos-runtime-host", "OwlRuntimeHost.swift");
const plist = path.join(runtimeRoot, "macos-runtime-host", "Info.plist");
const output = path.join(desktopRoot, "vendor", "runtime-host", "OWL Runtime.app");
const binaryDir = path.join(output, "Contents", "MacOS");
const resourcesDir = path.join(output, "Contents", "Resources");
const binary = path.join(binaryDir, "OwlRuntimeHost");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? desktopRoot,
    env: process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited with ${result.status}`);
  }
  return (result.stdout || result.stderr || "").trim();
}

if (!fs.existsSync(source) || !fs.existsSync(plist)) {
  throw new Error(`OWL Runtime Host source is missing in ${runtimeRoot}`);
}
const actualSha = run("git", ["rev-parse", "HEAD"], { cwd: runtimeRoot });
if (actualSha !== contract.gitSha) {
  throw new Error(
    `OWL Runtime Host must be built from pinned Runtime SHA ${contract.gitSha}; received ${actualSha}`,
  );
}

const temp = fs.mkdtempSync("/tmp/owl-runtime-host-");
try {
  const arm64 = path.join(temp, "OwlRuntimeHost.arm64");
  const x64 = path.join(temp, "OwlRuntimeHost.x64");

  run("/usr/bin/arch", [
    "-arm64",
    "/usr/bin/xcrun",
    "swiftc",
    "-O",
    source,
    "-o",
    arm64,
  ]);
  run("/usr/bin/arch", [
    "-x86_64",
    "/usr/bin/xcrun",
    "swiftc",
    "-O",
    source,
    "-o",
    x64,
  ]);

  fs.rmSync(path.dirname(output), { recursive: true, force: true });
  fs.mkdirSync(binaryDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  run("/usr/bin/lipo", ["-create", arm64, x64, "-output", binary]);
  fs.chmodSync(binary, 0o755);
  fs.copyFileSync(plist, path.join(output, "Contents", "Info.plist"));

  const lipo = run("/usr/bin/lipo", ["-info", binary]);
  if (!/arm64/.test(lipo) || !/x86_64/.test(lipo)) {
    throw new Error(`Universal Runtime Host verification failed: ${lipo}`);
  }

  const status = run(binary, ["--status"]);
  const parsed = JSON.parse(status);
  if (
    parsed.bundleIdentifier !== "fan.fde.owl.runtime" ||
    parsed.version !== "1.0.0"
  ) {
    throw new Error(`Unexpected Runtime Host identity: ${status}`);
  }

  const signingIdentity = process.env.OWL_RUNTIME_HOST_SIGNING_IDENTITY?.trim();
  if (signingIdentity) {
    run("/usr/bin/codesign", [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--sign",
      signingIdentity,
      output,
    ]);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtimeGitSha: actualSha,
        bundleIdentifier: parsed.bundleIdentifier,
        version: parsed.version,
        architectures: ["arm64", "x64"],
        signed: Boolean(signingIdentity),
        output,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
