#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const output = path.join(desktopRoot, "vendor", "owl-runtime");
const runtimeContract = JSON.parse(
  fs.readFileSync(
    path.join(desktopRoot, "docs/contracts/OWL_RUNTIME_COMPONENT_V1.json"),
    "utf8",
  ),
);

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

function repoHead(repo) {
  if (!fs.existsSync(path.join(repo, "package.json"))) return null;
  try {
    return run("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      capture: true,
    });
  } catch {
    return null;
  }
}

function resolveRuntimeRoot() {
  const explicit = process.env.OWL_RUNTIME_REPO?.trim();
  if (explicit) {
    const root = path.resolve(explicit);
    const head = repoHead(root);
    if (head !== runtimeContract.gitSha) {
      throw new Error(
        `OWL_RUNTIME_REPO must point to pinned Runtime SHA ${runtimeContract.gitSha}; received ${head ?? "unavailable"}.`,
      );
    }
    return { root, temporary: false, needsInstall: false };
  }

  const sibling = path.resolve(desktopRoot, "..", "owl-runtime");
  if (repoHead(sibling) === runtimeContract.gitSha) {
    return { root: sibling, temporary: false, needsInstall: false };
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "owl-runtime-release-"));
  const repository = runtimeContract.repository || "tubban1/owl-runtime";
  run("git", ["init", "-q", temp]);
  run("git", ["remote", "add", "origin", `https://github.com/${repository}.git`], {
    cwd: temp,
  });
  run(
    "git",
    ["fetch", "--depth", "1", "origin", runtimeContract.gitSha],
    { cwd: temp },
  );
  run("git", ["checkout", "--detach", "-q", "FETCH_HEAD"], { cwd: temp });
  const head = repoHead(temp);
  if (head !== runtimeContract.gitSha) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw new Error(
      `Fetched OWL Runtime SHA mismatch: expected ${runtimeContract.gitSha}, got ${head ?? "unavailable"}.`,
    );
  }
  return { root: temp, temporary: true, needsInstall: true };
}

const resolved = resolveRuntimeRoot();
const runtimeRoot = resolved.root;

try {
  if (resolved.needsInstall) {
    run(
      "npm",
      ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: runtimeRoot },
    );
  }

  const runtimePackage = JSON.parse(
    fs.readFileSync(path.join(runtimeRoot, "package.json"), "utf8"),
  );
  const sha = repoHead(runtimeRoot);
  if (sha !== runtimeContract.gitSha) {
    throw new Error(
      `OWL Runtime checkout is not the pinned release provider. Expected ${runtimeContract.gitSha}, received ${sha}.`,
    );
  }
  if (runtimePackage.version !== runtimeContract.runtimeVersion) {
    throw new Error(
      `OWL Runtime version mismatch. Expected ${runtimeContract.runtimeVersion}, received ${runtimePackage.version}.`,
    );
  }

  run("npm", ["run", "build"], { cwd: runtimeRoot });

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
    apiVersion: runtimeContract.apiVersion,
    fingerprint,
    entrypoint: "dist/server.js",
    nodeHost: "electron-run-as-node",
    sourceAuthority: runtimeContract.repository || "tubban1/owl-runtime",
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

  console.log(
    JSON.stringify(
      {
        ok: true,
        output,
        source: resolved.temporary ? "pinned-fetch" : "local-exact-checkout",
        manifest: finalManifest,
      },
      null,
      2,
    ),
  );
} finally {
  if (resolved.temporary) {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}
