#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/contracts/OWL_RUNTIME_COMPONENT_V1.json"),
    "utf8",
  ),
);

const apps = [
  {
    arch: "arm64",
    app: path.join(root, "release/smoke-arm64/mac-arm64/OWL LAB Desktop.app"),
  },
  {
    arch: "x64",
    app: path.join(root, "release/smoke-x64/mac/OWL LAB Desktop.app"),
  },
];

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return (result.stdout || result.stderr || "").trim();
}

for (const { arch, app } of apps) {
  if (!fs.existsSync(app)) throw new Error(`Missing packaged app: ${app}`);

  const binary = path.join(app, "Contents/MacOS/OWL LAB Desktop");
  const binaryInfo = run("/usr/bin/file", [binary]);
  const expected = arch === "arm64" ? /arm64/ : /x86_64/;
  if (!expected.test(binaryInfo)) {
    throw new Error(`Desktop binary architecture mismatch: ${binaryInfo}`);
  }

  const plist = path.join(app, "Contents/Info.plist");
  const bundleId = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    plist,
  ]);
  const bundleName = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleName",
    plist,
  ]);
  const iconName = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIconFile",
    plist,
  ]);
  if (bundleId !== "ai.owl.desktop" || bundleName !== "OWL LAB Desktop") {
    throw new Error(`Unexpected Desktop identity: ${bundleId} / ${bundleName}`);
  }

  const resources = path.join(app, "Contents/Resources");
  if (!fs.existsSync(path.join(resources, iconName))) {
    throw new Error(`Packaged icon is missing: ${iconName}`);
  }

  const asarFile = path.join(resources, "app.asar");
  const asarTool = path.join(root, "node_modules/.bin/asar");
  const asarEntries = run(asarTool, ["list", asarFile]);
  const requiredAsarEntries = [
    "/connection-host/server.mjs",
    "/connection-host/cloud-mcp-call-consumer.mjs",
    "/connection-host/cloud-mcp-completion-store.mjs",
    "/connection-host/local-mcp-executor.mjs",
    "/electron/services/connectivity-host-launch-agent.mjs",
    "/shared/abortable-await.mjs",
  ];
  for (const entry of requiredAsarEntries) {
    if (!asarEntries.includes(entry)) {
      throw new Error(`Packaged connectivity file is missing for ${arch}: ${entry}`);
    }
  }

  const runtimeManifest = JSON.parse(
    fs.readFileSync(path.join(resources, "owl-runtime/component.json"), "utf8"),
  );
  if (
    runtimeManifest.gitSha !== contract.gitSha ||
    runtimeManifest.version !== contract.runtimeVersion ||
    runtimeManifest.apiVersion !== contract.apiVersion
  ) {
    throw new Error(`Packaged Runtime does not match pinned contract for ${arch}`);
  }

  const tunnelArm = run("/usr/bin/file", [
    path.join(resources, "owl-tunnel/arm64/tunnel-client-runtime"),
  ]);
  const tunnelX64 = run("/usr/bin/file", [
    path.join(resources, "owl-tunnel/x64/tunnel-client-runtime"),
  ]);
  if (!/arm64/.test(tunnelArm) || !/x86_64/.test(tunnelX64)) {
    throw new Error(`Packaged Tunnel architecture mismatch for ${arch}`);
  }

  const host = path.join(
    resources,
    "runtime-host/OWL Runtime.app/Contents/MacOS/OwlRuntimeHost",
  );
  const hostInfo = run("/usr/bin/file", [host]);
  if (!/arm64/.test(hostInfo) || !/x86_64/.test(hostInfo)) {
    throw new Error(`Packaged Runtime Host is not universal for ${arch}`);
  }
  const hostStatus = JSON.parse(run(host, ["--status"]));
  if (
    hostStatus.bundleIdentifier !== "fan.fde.owl.runtime" ||
    hostStatus.version !== "1.0.0"
  ) {
    throw new Error(`Unexpected Runtime Host identity for ${arch}`);
  }

  const helperApp = path.join(resources, "helper/OWL LAB Helper.app");
  const helper = path.join(
    helperApp,
    "Contents/MacOS/ComputerMCPHelper",
  );
  const helperInfo = run("/usr/bin/file", [helper]);
  if (!/arm64/.test(helperInfo) || !/x86_64/.test(helperInfo)) {
    throw new Error(`Packaged Helper is not universal for ${arch}`);
  }
  const helperPlist = path.join(helperApp, "Contents/Info.plist");
  const helperBundle = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    helperPlist,
  ]);
  const helperVersion = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    helperPlist,
  ]);
  if (
    helperBundle !== "fan.fde.owl.helper" ||
    helperVersion !== "1.0.0"
  ) {
    throw new Error(`Unexpected Helper identity for ${arch}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      desktopVersion: "0.1.0",
      desktopBundleId: "ai.owl.desktop",
      packagedArchitectures: ["arm64", "x64"],
      runtimeGitSha: contract.gitSha,
      runtimeVersion: contract.runtimeVersion,
      runtimeApiVersion: contract.apiVersion,
      tunnelArchitecturesInEachBundle: ["arm64", "x64"],
      runtimeHost: {
        bundleIdentifier: "fan.fde.owl.runtime",
        version: "1.0.0",
        universal: true,
      },
      helper: {
        bundleIdentifier: "fan.fde.owl.helper",
        version: "1.0.0",
        universal: true,
      },
      customIcon: true,
      connectivityHostPackaged: true,
      signing: "intentionally skipped for smoke packaging",
    },
    null,
    2,
  ),
);
