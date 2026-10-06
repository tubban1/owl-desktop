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
    path.join(root, "docs/contracts/OWL_RUNTIME_NODE_COMPONENT_V1.json"),
    "utf8",
  ),
);
const cache = path.join(root, "build", "download-cache");

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || `${command} exited with ${result.status}`,
    );
  }
  return (result.stdout || result.stderr || "").trim();
}

async function obtain(arch, spec) {
  const outputDir = path.join(root, "vendor", "runtime-node", arch);
  const binary = path.join(outputDir, "bin", "node");
  const componentFile = path.join(outputDir, "component.json");
  const archive = path.join(cache, spec.tarball);
  const overrideKey =
    arch === "arm64"
      ? "OWL_RUNTIME_NODE_ARM64_TARBALL"
      : "OWL_RUNTIME_NODE_X64_TARBALL";
  const override = process.env[overrideKey]?.trim();

  fs.mkdirSync(cache, { recursive: true });
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`${overrideKey} does not exist: ${override}`);
    }
    fs.copyFileSync(override, archive);
  } else if (!fs.existsSync(archive) || sha256(archive) !== spec.sha256) {
    const url = `${contract.sourceBaseUrl}/${spec.tarball}`;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    }
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }

  const archiveSha = sha256(archive);
  if (archiveSha !== spec.sha256) {
    throw new Error(
      `OWL Runtime Node ${arch} archive SHA256 mismatch: expected ${spec.sha256}, got ${archiveSha}`,
    );
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `owl-runtime-node-${arch}-`));
  try {
    run("/usr/bin/tar", ["-xzf", archive, "-C", temp]);
    const extracted = path.join(
      temp,
      spec.tarball.replace(/\.tar\.gz$/, ""),
    );
    const sourceBinary = path.join(extracted, "bin", "node");
    const license = path.join(extracted, "LICENSE");
    if (!fs.existsSync(sourceBinary) || !fs.existsSync(license)) {
      throw new Error(
        `Node archive ${spec.tarball} is missing bin/node or LICENSE.`,
      );
    }

    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(outputDir, "bin"), { recursive: true });
    fs.copyFileSync(sourceBinary, binary);
    fs.copyFileSync(license, path.join(outputDir, "LICENSE"));
    fs.writeFileSync(
      path.join(outputDir, "VERSION"),
      `${contract.nodeVersion}\n`,
    );
    fs.chmodSync(binary, 0o755);

    const expectedArch = arch === "arm64" ? /arm64/ : /x86_64/;
    const fileInfo = run("/usr/bin/file", [binary]);
    if (!expectedArch.test(fileInfo)) {
      throw new Error(`Runtime Node ${arch} architecture mismatch: ${fileInfo}`);
    }
    const nativeArch = process.arch === "arm64" ? "arm64" : "x64";
    if (arch === nativeArch) {
      const version = run(binary, ["--version"]);
      if (version !== contract.nodeVersion) {
        throw new Error(`Runtime Node ${arch} version mismatch: ${version}`);
      }
    }

    const component = {
      contractVersion: contract.contractVersion,
      component: contract.component,
      architecture: arch,
      nodeVersion: contract.nodeVersion,
      executable: "bin/node",
      binarySha256: sha256(binary),
      sourceTarball: spec.tarball,
      sourceTarballSha256: archiveSha,
      sourceUrl: `${contract.sourceBaseUrl}/${spec.tarball}`,
    };
    fs.writeFileSync(
      componentFile,
      JSON.stringify(component, null, 2) + "\n",
    );
    return component;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const components = {};
for (const arch of ["arm64", "x64"]) {
  components[arch] = await obtain(arch, contract.artifacts[arch]);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      component: contract.component,
      nodeVersion: contract.nodeVersion,
      architectures: Object.fromEntries(
        Object.entries(components).map(([arch, value]) => [
          arch,
          { binarySha256: value.binarySha256 },
        ]),
      ),
    },
    null,
    2,
  ),
);
