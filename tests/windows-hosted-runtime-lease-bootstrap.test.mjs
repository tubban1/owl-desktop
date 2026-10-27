import {describe,it,expect,vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {generateKeyPairSync,createHash} from "node:crypto";
import {bootstrapSourceRuntimeVerifier,resolveSourceVerifierFile} from "../scripts/bootstrap-runtime-lease-trust.mjs";
import {ensureRuntimeLeaseTrust,OFFICIAL_OWL_CLOUD_ORIGIN,OFFICIAL_OWL_LEASE_SPKI_SHA256} from "../scripts/lib/runtime-lease-trust.mjs";

const home="C:\\Users\\guest";
const legacy="C:\\workspace\\owl-cloud-runtime-lease-public.pem";
describe("Issue #34 Windows source hosted Cloud public verifier",()=>{
 it("chooses a per-user trust file on new Windows installations",()=>{
  expect(resolveSourceVerifierFile({home,platform:"win32",env:{OWL_WINDOWS_LEGACY_LEASE_PUBLIC_KEY_FILE:legacy},exists:()=>false}))
   .toBe(path.join(home,".owl-lab","trust","owl-cloud-dev-runtime-lease-public.pem"));
 });
 it("preserves an existing Windows legacy public verifier and explicit override",()=>{
  const exists=x=>x===legacy;
  expect(resolveSourceVerifierFile({home,platform:"win32",env:{OWL_WINDOWS_LEGACY_LEASE_PUBLIC_KEY_FILE:legacy},exists})).toBe(path.resolve(legacy));
  const explicit=path.resolve("./my-verified.pem");
  expect(resolveSourceVerifierFile({home,platform:"win32",env:{OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE:explicit,OWL_WINDOWS_LEGACY_LEASE_PUBLIC_KEY_FILE:legacy},exists})).toBe(explicit);
 });
 it("passes only the independently pinned official signer fingerprint, not a fetched self-pin",async()=>{
  const provision=vi.fn(async()=>({status:"installed",fingerprint:OFFICIAL_OWL_LEASE_SPKI_SHA256}));
  const answer=await bootstrapSourceRuntimeVerifier({home,platform:"win32",env:{},exists:()=>false,provision});
  expect(answer.status).toBe("installed");
  expect(provision).toHaveBeenCalledWith({filePath:answer.filePath,
    cloudBaseUrl:OFFICIAL_OWL_CLOUD_ORIGIN,expectedFingerprint:OFFICIAL_OWL_LEASE_SPKI_SHA256});
 });
 it("refuses mismatch without installing anything",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"owl-issue34-win-"));
  try{
   const {publicKey}=generateKeyPairSync("ed25519");
   const key=publicKey.export({type:"spki",format:"pem"}).toString();
   const digest=createHash("sha256").update(publicKey.export({type:"spki",format:"der"})).digest("hex");
   const filePath=path.join(tmp,"verifier.pem");
   const transport=async()=>({ok:true,text:async()=>JSON.stringify({schemaVersion:1,purpose:"owl-runtime-lease-verification",
     algorithm:"Ed25519",keyId:"test",spkiSha256:digest,publicKeyPem:key})});
   await expect(ensureRuntimeLeaseTrust({filePath,fetchImpl:transport})).rejects.toThrow(/FINGERPRINT_MISMATCH/);
   await expect(fs.stat(filePath)).rejects.toMatchObject({code:"ENOENT"});
  } finally {await fs.rm(tmp,{recursive:true,force:true});}
 });
 it("keeps the Windows launcher strict and runs bootstrap before starting Desktop",async()=>{
  const launcher=await fs.readFile(new URL("../scripts/windows/dev-desktop.ps1",import.meta.url),"utf8");
  expect(launcher).toContain('scripts/bootstrap-runtime-lease-trust.mjs');
  expect(launcher).toContain('OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE=$key');
  expect(launcher).toContain('WINDOWS_DEV_RUNTIME_TRUST_BOOTSTRAP_FAILED');
  expect(launcher.indexOf('scripts/bootstrap-runtime-lease-trust.mjs'))
   .toBeLessThan(launcher.indexOf('npm.cmd run dev:desktop'));
  expect(launcher).not.toContain('OWL_RUNTIME_ACCESS_MODE="compat"');
 });
});
