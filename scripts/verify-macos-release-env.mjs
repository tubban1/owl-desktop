#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const failures = [];

if (process.platform !== "darwin") {
  failures.push("macOS release packaging must run on macOS.");
}

if (!fs.existsSync("build/icon.icns")) {
  failures.push("build/icon.icns is missing; release builds may not use the Electron default icon.");
}

if (!fs.existsSync("vendor/owl-runtime/component.json")) {
  failures.push("Staged OWL Runtime component is missing.");
}
for (const arch of ["arm64", "x64"]) {
  if (!fs.existsSync(`vendor/owl-tunnel/${arch}/tunnel-client-runtime`)) {
    failures.push(`Staged OWL Tunnel ${arch} binary is missing.`);
  }
}

const hostApp = "vendor/runtime-host/OWL Runtime.app";
const hostBinary = `${hostApp}/Contents/MacOS/OwlRuntimeHost`;
if (!fs.existsSync(hostBinary)) {
  failures.push("Signed universal OWL Runtime Host artifact is missing.");
} else {
  const lipo = spawnSync("/usr/bin/lipo", ["-info", hostBinary], {
    encoding: "utf8",
  });
  const info = `${lipo.stdout ?? ""} ${lipo.stderr ?? ""}`;
  if (!/arm64/.test(info) || !/x86_64/.test(info)) {
    failures.push("OWL Runtime Host release artifact must contain arm64 and x86_64.");
  }
  const hostSignature = spawnSync("/usr/bin/codesign", [
    "-dv",
    "--verbose=2",
    hostApp,
  ], { encoding: "utf8" });
  const signatureText =
    `${hostSignature.stdout ?? ""} ${hostSignature.stderr ?? ""}`;
  if (!/TeamIdentifier=\S+/.test(signatureText) || /Signature=adhoc/.test(signatureText)) {
    failures.push("OWL Runtime Host must carry a non-ad-hoc Developer ID signature.");
  }
}

const helperApp = "vendor/helper/OWL LAB Helper.app";
const helperBinary = `${helperApp}/Contents/MacOS/ComputerMCPHelper`;
if (!fs.existsSync(helperBinary)) {
  failures.push("Signed universal OWL LAB Helper artifact is missing.");
} else {
  const lipo = spawnSync("/usr/bin/lipo", ["-info", helperBinary], {
    encoding: "utf8",
  });
  const info = `${lipo.stdout ?? ""} ${lipo.stderr ?? ""}`;
  if (!/arm64/.test(info) || !/x86_64/.test(info)) {
    failures.push("OWL LAB Helper release artifact must contain arm64 and x86_64.");
  }
  const helperSignature = spawnSync("/usr/bin/codesign", [
    "-dv",
    "--verbose=2",
    helperApp,
  ], { encoding: "utf8" });
  const signatureText =
    `${helperSignature.stdout ?? ""} ${helperSignature.stderr ?? ""}`;
  if (!/TeamIdentifier=\S+/.test(signatureText) || /Signature=adhoc/.test(signatureText)) {
    failures.push("OWL LAB Helper must carry a non-ad-hoc Developer ID signature.");
  }
}

const identities = spawnSync(
  "/usr/bin/security",
  ["find-identity", "-v", "-p", "codesigning"],
  { encoding: "utf8" },
);
if (
  identities.status !== 0 ||
  !/Developer ID Application/.test(identities.stdout ?? "")
) {
  failures.push("No valid Developer ID Application signing identity is available.");
}

if (!process.env.APPLE_TEAM_ID?.trim()) {
  failures.push("APPLE_TEAM_ID is required for notarization.");
}

const hasAppleId =
  process.env.APPLE_ID?.trim() &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim();
const hasApiKey =
  process.env.APPLE_API_KEY?.trim() &&
  process.env.APPLE_API_KEY_ID?.trim() &&
  process.env.APPLE_API_ISSUER?.trim();

if (!hasAppleId && !hasApiKey) {
  failures.push(
    "Notarization credentials are missing. Configure Apple ID credentials or App Store Connect API key credentials.",
  );
}

if (failures.length) {
  console.error("OWL Desktop macOS release gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(2);
}

console.log(JSON.stringify({
  ok: true,
  signing: "Developer ID Application",
  notarization: hasAppleId ? "apple-id" : "app-store-connect-api-key",
  architectures: ["arm64", "x64"],
  hardenedRuntime: true,
}, null, 2));
