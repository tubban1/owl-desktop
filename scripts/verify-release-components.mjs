#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
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
      extraResources: true,
    },
    null,
    2,
  ),
);
