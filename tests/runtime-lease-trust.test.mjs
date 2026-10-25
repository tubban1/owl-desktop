import {test} from "vitest";
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {ensureRuntimeLeaseTrust,OFFICIAL_OWL_CLOUD_ORIGIN} from "../scripts/lib/runtime-lease-trust.mjs";

function verifier() {
  const {publicKey}=generateKeyPairSync("ed25519");
  const publicKeyPem=publicKey.export({type:"spki",format:"pem"}).toString();
  const spkiSha256=createHash("sha256").update(publicKey.export({type:"spki",format:"der"})).digest("hex");
  return {schemaVersion:1,purpose:"owl-runtime-lease-verification",algorithm:"Ed25519",
    publicKeyPem,spkiSha256,keyId:"ed25519-spki-sha256:"+spkiSha256};
}
function transport(body) {
  return async (url,options) => {
    assert.equal(url,OFFICIAL_OWL_CLOUD_ORIGIN+"/trust/runtime-lease/v1");
    assert.equal(options.redirect,"error");
    return {ok:true,text:async()=>JSON.stringify(body)};
  };
}
test("first run securely provisions and pins the hosted Cloud verifier",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-lease-test-"));
  try{
    const filePath=path.join(dir,"trust","verifier.pem");
    const key=verifier();
    const first=await ensureRuntimeLeaseTrust({filePath,fetchImpl:transport(key),expectedFingerprint:key.spkiSha256});
    assert.equal(first.status,"installed");
    assert.equal(await fs.readFile(filePath,"utf8"),key.publicKeyPem);
    assert.equal((await ensureRuntimeLeaseTrust({filePath,fetchImpl:transport(key),expectedFingerprint:key.spkiSha256})).status,"verified-existing");
    const rotated=verifier();
    await assert.rejects(()=>ensureRuntimeLeaseTrust({filePath,fetchImpl:transport(rotated),expectedFingerprint:null}),/ROTATION_REQUIRES_REVIEW/);
    assert.equal(await fs.readFile(filePath,"utf8"),key.publicKeyPem);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test("default source installation rejects a remotely served key that is not independently pinned", async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-lease-pin-"));
  try {
    await assert.rejects(()=>ensureRuntimeLeaseTrust({
      filePath:path.join(dir,"key.pem"),fetchImpl:transport(verifier())}),/FINGERPRINT_MISMATCH/);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test("untrusted Cloud origin, invalid key and fingerprint all fail closed",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-lease-fail-"));
 try {
  const filePath=path.join(dir,"key.pem"),key=verifier();
  await assert.rejects(()=>ensureRuntimeLeaseTrust({filePath,cloudBaseUrl:"http://evil.invalid",fetchImpl:transport(key)}),/UNRECOGNIZED_CLOUD/);
  await assert.rejects(()=>ensureRuntimeLeaseTrust({filePath,fetchImpl:transport({...key,publicKeyPem:"invalid"}),expectedFingerprint:null}),/INVALID_PEM/);
  await assert.rejects(()=>ensureRuntimeLeaseTrust({filePath,fetchImpl:transport(key),expectedFingerprint:"0".repeat(64)}),/FINGERPRINT_MISMATCH/);
  await assert.rejects(()=>ensureRuntimeLeaseTrust({filePath,fetchImpl:async()=>({ok:false,status:503}),expectedFingerprint:null}),/BOOTSTRAP_FAILED/);
  await assert.rejects(fs.stat(filePath),{code:"ENOENT"});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test("previously verified cached public key continues offline without bypassing signatures",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-lease-offline-"));
 try{
  const filePath=path.join(dir,"key.pem"),key=verifier();
  await ensureRuntimeLeaseTrust({filePath,fetchImpl:transport(key),expectedFingerprint:key.spkiSha256});
  assert.equal((await ensureRuntimeLeaseTrust({filePath,fetchImpl:async()=>{throw Error("offline")},expectedFingerprint:key.spkiSha256})).status,"existing-offline-anchor");
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
