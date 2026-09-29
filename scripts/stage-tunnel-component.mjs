#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = process.env.OWL_TUNNEL_BINARY?.trim();
if (!source || !fs.existsSync(source)) {
  throw new Error(
    "Set OWL_TUNNEL_BINARY to a versioned tunnel-client-runtime executable.",
  );
}

const fileInfo = spawnSync("/usr/bin/file", [source], {
  encoding: "utf8",
});
if (fileInfo.status !== 0) {
  throw new Error(fileInfo.stderr || "Unable to inspect OWL Tunnel binary.");
}

const description = fileInfo.stdout;
const arch = /arm64/.test(description)
  ? "arm64"
  : /x86_64/.test(description)
    ? "x64"
    : null;
if (!arch) {
  throw new Error(`Unsupported tunnel architecture: ${description.trim()}`);
}

const versionRun = spawnSync(source, ["--version"], {
  encoding: "utf8",
});
const versionText = (versionRun.stdout || versionRun.stderr || "").trim();
const outputDir = path.join(root, "vendor", "owl-tunnel", arch);
const output = path.join(outputDir, "tunnel-client-runtime");
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(source, output);
fs.chmodSync(output, 0o755);

const sha256 = createHash("sha256")
  .update(fs.readFileSync(output))
  .digest("hex");

const manifest = {
  component: "owl-tunnel",
  architecture: arch,
  versionText,
  sha256,
  executable: "tunnel-client-runtime",
  sourceAuthority: "owl-tunnel-compatible-transport",
};

fs.writeFileSync(
  path.join(outputDir, "component.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

console.log(JSON.stringify({ ok: true, output, manifest }, null, 2));
