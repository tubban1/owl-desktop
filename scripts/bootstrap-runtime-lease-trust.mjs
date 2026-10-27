#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  ensureRuntimeLeaseTrust,
  OFFICIAL_OWL_CLOUD_ORIGIN,
  OFFICIAL_OWL_LEASE_SPKI_SHA256,
} from "./lib/runtime-lease-trust.mjs";

/**
 * Public-verifier first-run bootstrap shared by source launchers.
 * Account enrollment, OAuth, private leases and signing keys are never handled
 * here. The pinned official SPKI fingerprint is checked before installation.
 */
export function resolveSourceVerifierFile({
  env=process.env, home=os.homedir(), platform=process.platform, exists=fs.existsSync
}={}) {
  const explicit=env.OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE?.trim();
  if(explicit) return path.resolve(explicit);
  const standard=path.join(home,".owl-lab","trust","owl-cloud-dev-runtime-lease-public.pem");
  const legacy=env.OWL_WINDOWS_LEGACY_LEASE_PUBLIC_KEY_FILE?.trim();
  // Preserve an already-installed, manually verified Windows source trust
  // anchor. ensureRuntimeLeaseTrust ALWAYS re-verifies its pinned fingerprint.
  if(platform==="win32"&&!exists(standard)&&legacy&&exists(legacy)) return path.resolve(legacy);
  return standard;
}

export async function bootstrapSourceRuntimeVerifier({
  env=process.env,home=os.homedir(),platform=process.platform,
  exists=fs.existsSync, provision=ensureRuntimeLeaseTrust
}={}) {
  const filePath=resolveSourceVerifierFile({env,home,platform,exists});
  const result=await provision({
    filePath,
    cloudBaseUrl:env.OWL_CLOUD_BASE_URL?.trim()||OFFICIAL_OWL_CLOUD_ORIGIN,
    expectedFingerprint:env.OWL_RUNTIME_LEASE_EXPECTED_SPKI_SHA256?.trim()||OFFICIAL_OWL_LEASE_SPKI_SHA256,
  });
  return {filePath,status:result.status,fingerprint:result.fingerprint};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const answer=await bootstrapSourceRuntimeVerifier();
    console.log("OWL_RUNTIME_PUBLIC_VERIFIER_READY "+JSON.stringify(answer));
  }catch(error){
    const message=String(error instanceof Error?error.message:error);
    console.error("OWL_RUNTIME_PUBLIC_VERIFIER_FAILED: "+message);
    process.exitCode=1;
  }
}
