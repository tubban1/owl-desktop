#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contract = JSON.parse(
  fs.readFileSync(
    path.join(desktopRoot, "docs/contracts/OWL_RUNTIME_COMPONENT_V1.json"),
    "utf8",
  ),
);
const output = path.join(
  desktopRoot,
  "vendor",
  "helper",
  "OWL LAB Helper.app",
);
const binaryDir = path.join(output, "Contents", "MacOS");
const resourcesDir = path.join(output, "Contents", "Resources");
const binary = path.join(binaryDir, "ComputerMCPHelper");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? desktopRoot,
    env: process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    maxBuffer: 10 * 1024 * 1024,
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

function repoHead(repo) {
  if (
    !fs.existsSync(
      path.join(repo, "macos-helper", "ComputerMCPHelper.swift"),
    )
  ) {
    return null;
  }
  try {
    return run("git", ["rev-parse", "HEAD"], { cwd: repo });
  } catch {
    return null;
  }
}

function resolveRuntimeSource() {
  const explicit = process.env.OWL_RUNTIME_REPO?.trim();
  if (explicit) {
    const root = path.resolve(explicit);
    const head = repoHead(root);
    if (head !== contract.gitSha) {
      throw new Error(
        `OWL_RUNTIME_REPO must point to pinned Runtime SHA ${contract.gitSha}; received ${head ?? "unavailable"}.`,
      );
    }
    return { root, temporary: false };
  }

  const sibling = path.resolve(desktopRoot, "..", "owl-runtime");
  if (repoHead(sibling) === contract.gitSha) {
    return { root: sibling, temporary: false };
  }

  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "owl-helper-source-"),
  );
  const repository = contract.repository || "tubban1/owl-runtime";
  run("git", ["init", "-q", temp]);
  run(
    "git",
    ["remote", "add", "origin", `https://github.com/${repository}.git`],
    { cwd: temp },
  );
  run(
    "git",
    ["fetch", "--depth", "1", "origin", contract.gitSha],
    { cwd: temp },
  );
  run("git", ["checkout", "--detach", "-q", "FETCH_HEAD"], {
    cwd: temp,
  });

  const head = repoHead(temp);
  if (head !== contract.gitSha) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw new Error(
      `Fetched Helper source mismatch: expected ${contract.gitSha}, got ${head ?? "unavailable"}.`,
    );
  }
  return { root: temp, temporary: true };
}

const resolved = resolveRuntimeSource();
const runtimeRoot = resolved.root;
const source = path.join(
  runtimeRoot,
  "macos-helper",
  "ComputerMCPHelper.swift",
);
const plist = path.join(runtimeRoot, "macos-helper", "Info.plist");

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "owl-lab-helper-build-"),
);
try {
  const arm64 = path.join(temp, "ComputerMCPHelper.arm64");
  const x64 = path.join(temp, "ComputerMCPHelper.x64");

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
  run("/usr/bin/lipo", [
    "-create",
    arm64,
    x64,
    "-output",
    binary,
  ]);
  fs.chmodSync(binary, 0o755);
  fs.copyFileSync(
    plist,
    path.join(output, "Contents", "Info.plist"),
  );

  const lipo = run("/usr/bin/lipo", ["-info", binary]);
  if (!/arm64/.test(lipo) || !/x86_64/.test(lipo)) {
    throw new Error(
      `Universal Helper verification failed: ${lipo}`,
    );
  }

  const bundleId = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    path.join(output, "Contents", "Info.plist"),
  ]);
  const version = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    path.join(output, "Contents", "Info.plist"),
  ]);
  if (
    bundleId !== "fan.fde.owl.helper" ||
    version !== "1.0.0"
  ) {
    throw new Error(
      `Unexpected Helper identity: ${bundleId}@${version}`,
    );
  }

  const signingIdentity =
    process.env.OWL_HELPER_SIGNING_IDENTITY?.trim();
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
        runtimeGitSha: contract.gitSha,
        source:
          resolved.temporary
            ? "pinned-fetch"
            : "local-exact-checkout",
        bundleIdentifier: bundleId,
        version,
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
  if (resolved.temporary) {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}
