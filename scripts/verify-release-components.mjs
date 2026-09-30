#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseConfig = fs.readFileSync(
  path.join(root, "electron-builder.release.yml"),
  "utf8",
);
if (!/^productName:\s*OWL LAB Desktop\s*$/m.test(releaseConfig)) {
  throw new Error("Release config productName must be OWL LAB Desktop.");
}
if (
  !/from:\s*vendor\/helper/.test(releaseConfig) ||
  !/to:\s*helper/.test(releaseConfig)
) {
  throw new Error("Release config must package OWL LAB Helper.");
}
if (!/notarize:\s*true/.test(releaseConfig)) {
  throw new Error("Release config must require macOS notarization.");
}
const protocol = JSON.parse(
  fs.readFileSync(path.join(root, "vendor/owl-tunnel/protocol.json"), "utf8"),
);
const runtimeContract = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/contracts/OWL_RUNTIME_COMPONENT_V1.json"),
    "utf8",
  ),
);
const runtimeManifest = JSON.parse(
  fs.readFileSync(path.join(root, "vendor/owl-runtime/component.json"), "utf8"),
);
if (runtimeManifest.gitSha !== runtimeContract.gitSha) {
  throw new Error(
    `Staged OWL Runtime SHA mismatch: expected ${runtimeContract.gitSha}, got ${runtimeManifest.gitSha}`,
  );
}
if (
  runtimeManifest.version !== runtimeContract.runtimeVersion ||
  runtimeManifest.apiVersion !== runtimeContract.apiVersion
) {
  throw new Error("Staged OWL Runtime version/API does not match the pinned contract.");
}

if (protocol.protocolVersion !== "owl-tunnel-consumer-v1") {
  throw new Error("Unexpected OWL Tunnel consumer protocol version.");
}
if (protocol.vendorVersion !== "0.0.15") {
  throw new Error("Unexpected OWL Tunnel vendor version.");
}

const packaged = (pkg.build?.extraResources ?? []).some(
  (entry) => entry.from === "vendor/owl-tunnel" && entry.to === "owl-tunnel",
);
if (!packaged) {
  throw new Error("OWL Tunnel is not included in Desktop extraResources.");
}

for (const arch of ["arm64", "x64"]) {
  const dir = path.join(root, "vendor/owl-tunnel", arch);
  const binary = path.join(dir, "tunnel-client-runtime");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "component.json"), "utf8"),
  );
  const actualSha = createHash("sha256")
    .update(fs.readFileSync(binary))
    .digest("hex");
  if (manifest.architecture !== arch) {
    throw new Error(`Tunnel manifest arch mismatch for ${arch}.`);
  }
  if (manifest.sha256 !== actualSha) {
    throw new Error(`Tunnel SHA256 mismatch for ${arch}.`);
  }
  if (protocol.architectures?.[arch]?.sha256 !== actualSha) {
    throw new Error(`Tunnel protocol manifest SHA mismatch for ${arch}.`);
  }

  const file = spawnSync("/usr/bin/file", [binary], { encoding: "utf8" });
  if (file.status !== 0) throw new Error(file.stderr || "file(1) failed.");
  const expected = arch === "arm64" ? /arm64/ : /x86_64/;
  if (!expected.test(file.stdout)) {
    throw new Error(`Tunnel binary architecture mismatch for ${arch}: ${file.stdout}`);
  }
}

const hostApp = path.join(root, "vendor/runtime-host/OWL Runtime.app");
const hostBinary = path.join(hostApp, "Contents/MacOS/OwlRuntimeHost");
if (!fs.existsSync(hostBinary)) {
  throw new Error("Universal OWL Runtime Host is missing.");
}
const hostLipo = spawnSync("/usr/bin/lipo", ["-info", hostBinary], {
  encoding: "utf8",
});
const hostArch = `${hostLipo.stdout ?? ""} ${hostLipo.stderr ?? ""}`;
if (hostLipo.status !== 0 || !/arm64/.test(hostArch) || !/x86_64/.test(hostArch)) {
  throw new Error(`OWL Runtime Host is not universal: ${hostArch}`);
}
const hostStatus = spawnSync(hostBinary, ["--status"], { encoding: "utf8" });
if (hostStatus.status !== 0) {
  throw new Error(hostStatus.stderr || "OWL Runtime Host --status failed.");
}
const hostIdentity = JSON.parse(hostStatus.stdout);
if (
  hostIdentity.bundleIdentifier !== "fan.fde.owl.runtime" ||
  hostIdentity.version !== "1.0.0"
) {
  throw new Error(`Unexpected OWL Runtime Host identity: ${hostStatus.stdout}`);
}
const hostPackaged = (pkg.build?.extraResources ?? []).some(
  (entry) => entry.from === "vendor/runtime-host" && entry.to === "runtime-host",
);
if (!hostPackaged) {
  throw new Error("OWL Runtime Host is not included in Desktop extraResources.");
}

const helperApp = path.join(root, "vendor/helper/OWL LAB Helper.app");
const helperBinary = path.join(
  helperApp,
  "Contents/MacOS/ComputerMCPHelper",
);
if (!fs.existsSync(helperBinary)) {
  throw new Error("Universal OWL LAB Helper is missing.");
}
const helperLipo = spawnSync("/usr/bin/lipo", ["-info", helperBinary], {
  encoding: "utf8",
});
const helperArch = `${helperLipo.stdout ?? ""} ${helperLipo.stderr ?? ""}`;
if (
  helperLipo.status !== 0 ||
  !/arm64/.test(helperArch) ||
  !/x86_64/.test(helperArch)
) {
  throw new Error(`OWL LAB Helper is not universal: ${helperArch}`);
}
const helperPlist = path.join(helperApp, "Contents/Info.plist");
const helperBundle = spawnSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleIdentifier", helperPlist],
  { encoding: "utf8" },
);
const helperVersion = spawnSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleShortVersionString", helperPlist],
  { encoding: "utf8" },
);
if (
  helperBundle.status !== 0 ||
  helperVersion.status !== 0 ||
  helperBundle.stdout.trim() !== "fan.fde.owl.helper" ||
  helperVersion.stdout.trim() !== "1.0.0"
) {
  throw new Error(
    `Unexpected OWL LAB Helper identity: ${helperBundle.stdout.trim()}@${helperVersion.stdout.trim()}`,
  );
}
const helperPackaged = (pkg.build?.extraResources ?? []).some(
  (entry) => entry.from === "vendor/helper" && entry.to === "helper",
);
if (!helperPackaged) {
  throw new Error("OWL LAB Helper is not included in Desktop extraResources.");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      runtimeGitSha: runtimeManifest.gitSha,
      runtimeVersion: runtimeManifest.version,
      runtimeApiVersion: runtimeManifest.apiVersion,
      protocolVersion: protocol.protocolVersion,
      vendorVersion: protocol.vendorVersion,
      vendorGitSha: protocol.vendorGitSha,
      mcpTransport: protocol.mcpTransport,
      packagedArchitectures: ["arm64", "x64"],
      runtimeHost: {
        bundleIdentifier: hostIdentity.bundleIdentifier,
        version: hostIdentity.version,
        architectures: ["arm64", "x86_64"],
      },
      helper: {
        bundleIdentifier: helperBundle.stdout.trim(),
        version: helperVersion.stdout.trim(),
        architectures: ["arm64", "x86_64"],
      },
      extraResources: true,
    },
    null,
    2,
  ),
);
