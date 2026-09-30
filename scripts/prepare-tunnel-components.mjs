#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/contracts/OWL_TUNNEL_COMPONENT_V1.json"),
    "utf8",
  ),
);

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr ||
        result.stdout ||
        `${command} exited with ${result.status}`,
    );
  }
  return (result.stdout || result.stderr || "").trim();
}

function findBinary(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(full);
      if (found) return found;
    } else if (entry.name === "tunnel-client-runtime") {
      return full;
    }
  }
  return null;
}

async function obtain(arch, spec) {
  const outputDir = path.join(root, "vendor", "owl-tunnel", arch);
  const output = path.join(outputDir, "tunnel-client-runtime");
  const envKey =
    arch === "arm64"
      ? "OWL_TUNNEL_ARM64_BINARY"
      : "OWL_TUNNEL_X64_BINARY";
  const override = process.env[envKey]?.trim();

  fs.mkdirSync(outputDir, { recursive: true });

  if (fs.existsSync(output) && sha256(output) === spec.executableSha256) {
    return output;
  }

  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`${envKey} does not exist: ${override}`);
    }
    fs.copyFileSync(override, output);
  } else {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `owl-tunnel-${arch}-`));
    try {
      const zip = path.join(temp, "artifact.zip");
      const response = await fetch(spec.url, { redirect: "follow" });
      if (!response.ok) {
        throw new Error(
          `Failed to download OWL Tunnel ${arch}: HTTP ${response.status}`,
        );
      }
      fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
      const extracted = path.join(temp, "extracted");
      fs.mkdirSync(extracted, { recursive: true });
      run("/usr/bin/unzip", ["-q", "-o", zip, "-d", extracted]);
      const binary = findBinary(extracted);
      if (!binary) {
        throw new Error(
          `Downloaded OWL Tunnel archive for ${arch} contains no tunnel-client-runtime.`,
        );
      }
      fs.copyFileSync(binary, output);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }

  fs.chmodSync(output, 0o755);
  const actual = sha256(output);
  if (actual !== spec.executableSha256) {
    fs.rmSync(output, { force: true });
    throw new Error(
      `OWL Tunnel ${arch} SHA256 mismatch: expected ${spec.executableSha256}, got ${actual}`,
    );
  }
  return output;
}

const manifests = {};
for (const arch of ["arm64", "x64"]) {
  const spec = contract.artifacts[arch];
  const output = await obtain(arch, spec);
  const fileInfo = run("/usr/bin/file", [output]);
  const expected = arch === "arm64" ? /arm64/ : /x86_64/;
  if (!expected.test(fileInfo)) {
    throw new Error(`OWL Tunnel ${arch} architecture mismatch: ${fileInfo}`);
  }

  const versionText = run(output, ["--version"]);
  if (!versionText.startsWith(contract.vendor.version)) {
    throw new Error(
      `OWL Tunnel ${arch} version mismatch: ${versionText}`,
    );
  }
  if (!versionText.includes(contract.vendor.gitSha)) {
    throw new Error(
      `OWL Tunnel ${arch} git SHA mismatch: ${versionText}`,
    );
  }

  const manifest = {
    component: "owl-tunnel",
    architecture: arch,
    protocolVersion: contract.protocolVersion,
    versionText,
    sha256: sha256(output),
    executable: "tunnel-client-runtime",
    sourceAuthority: contract.vendor.repository,
  };
  fs.writeFileSync(
    path.join(root, "vendor", "owl-tunnel", arch, "component.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  manifests[arch] = manifest;
}

fs.writeFileSync(
  path.join(root, "vendor", "owl-tunnel", "protocol.json"),
  JSON.stringify(
    {
      contractVersion: contract.contractVersion,
      protocolVersion: contract.protocolVersion,
      vendorComponent: contract.vendor.repository,
      vendorVersion: contract.vendor.version,
      vendorGitSha: contract.vendor.gitSha,
      mcpTransport: contract.mcpTransport,
      lifecycleOwner: contract.lifecycleOwner,
      secretTransport: contract.secretTransport,
      architectures: {
        arm64: { sha256: manifests.arm64.sha256 },
        x64: { sha256: manifests.x64.sha256 },
      },
    },
    null,
    2,
  ) + "\n",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      protocolVersion: contract.protocolVersion,
      vendorVersion: contract.vendor.version,
      architectures: Object.fromEntries(
        Object.entries(manifests).map(([arch, manifest]) => [
          arch,
          { sha256: manifest.sha256, versionText: manifest.versionText },
        ]),
      ),
    },
    null,
    2,
  ),
);
