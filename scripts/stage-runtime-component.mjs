#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runtimeRoot = path.resolve(
  process.env.OWL_RUNTIME_REPO ||
    path.join(desktopRoot, "..", "owl-runtime"),
);
const output = path.join(desktopRoot, "vendor", "owl-runtime");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? desktopRoot,
    env: process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout || result.status}`,
    );
  }
  return (result.stdout ?? "").trim();
}

if (!fs.existsSync(path.join(runtimeRoot, "package.json"))) {
  throw new Error(`OWL Runtime repo not found: ${runtimeRoot}`);
}

run("npm", ["run", "build"], { cwd: runtimeRoot });
const runtimePackage = JSON.parse(
  fs.readFileSync(path.join(runtimeRoot, "package.json"), "utf8"),
);
const sha = run("git", ["rev-parse", "HEAD"], {
  cwd: runtimeRoot,
  capture: true,
});

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.join(runtimeRoot, "dist"), path.join(output, "dist"), {
  recursive: true,
});
for (const file of ["package.json", "package-lock.json"]) {
  fs.copyFileSync(
    path.join(runtimeRoot, file),
    path.join(output, file),
  );
}

run(
  "npm",
  [
    "ci",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ],
  { cwd: output },
);

const fingerprint = createHash("sha256")
  .update(runtimePackage.version)
  .update("\n")
  .update(sha)
  .update("\n")
  .update(fs.readFileSync(path.join(output, "dist", "server.js")))
  .digest("hex");

const manifest = {
  component: "owl-runtime",
  version: runtimePackage.version,
  gitSha: sha,
  apiVersion: "0.1",
  fingerprint,
  entrypoint: "dist/server.js",
  nodeHost: "electron-run-as-node",
  sourceAuthority: "owl-runtime",
};

fs.writeFileSync(
  path.join(output, "component.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { mode: 0o644 },
);

const archive = path.join(output, "owl-runtime-release.tgz");
run(
  "/usr/bin/tar",
  [
    "-czf",
    archive,
    "dist",
    "node_modules",
    "package.json",
    "package-lock.json",
    "component.json",
  ],
  { cwd: output },
);
const archiveSha256 = createHash("sha256")
  .update(fs.readFileSync(archive))
  .digest("hex");
const finalManifest = {
  ...manifest,
  archive: "owl-runtime-release.tgz",
  archiveSha256,
};
fs.writeFileSync(
  path.join(output, "component.json"),
  JSON.stringify(finalManifest, null, 2) + "\n",
  { mode: 0o644 },
);

console.log(JSON.stringify({
  ok: true,
  output,
  manifest: finalManifest,
}, null, 2));
