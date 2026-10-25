import fs from "node:fs/promises";
import path from "node:path";
import { createHash, createPublicKey } from "node:crypto";

export const OFFICIAL_OWL_CLOUD_ORIGIN =
  "https://yh9cjtolx6.execute-api.eu-central-1.amazonaws.com";
// Independent first-install trust pin derived from the official hosted DEV
// signer in AWS Secrets Manager; never from the HTTPS response itself.
export const OFFICIAL_OWL_LEASE_SPKI_SHA256 =
  "338c53a1171f7d11bd13b96a916b1752af03317d483ee6ae6918d885686409b7";
const ENDPOINT = "/trust/runtime-lease/v1";
const SHA256 = /^[a-f0-9]{64}$/;

function parseVerifier(pem) {
  const value = String(pem ?? "").trim();
  if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(value) ||
      value.length > 4096) throw Error("RUNTIME_LEASE_TRUST_INVALID_PEM");
  let key;
  try { key = createPublicKey(value); }
  catch { throw Error("RUNTIME_LEASE_TRUST_INVALID_PEM"); }
  if (key.asymmetricKeyType !== "ed25519") throw Error("RUNTIME_LEASE_TRUST_WRONG_ALGORITHM");
  return {
    pem: key.export({ type:"spki", format:"pem" }).toString(),
    fingerprint: createHash("sha256")
      .update(key.export({ type:"spki", format:"der" })).digest("hex"),
  };
}

function trustedCloudOrigin(value) {
  let url;
  try { url = new URL(String(value ?? "")); }
  catch { throw Error("RUNTIME_LEASE_TRUST_CLOUD_ORIGIN_INVALID"); }
  if (url.origin !== OFFICIAL_OWL_CLOUD_ORIGIN ||
      url.protocol !== "https:" ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search || url.hash || url.username || url.password) {
    throw Error("RUNTIME_LEASE_TRUST_UNRECOGNIZED_CLOUD: Automatic verifier bootstrap only supports the pinned official OWL Cloud origin. Self-hosted Clouds must explicitly supply their trusted verifier file.");
  }
  return url.origin;
}

/**
 * Bootstrap from the project's pinned HTTPS Cloud origin and pin the Ed25519
 * SPKI on first enrollment. Subsequent key changes FAIL CLOSED: a changed
 * public key cannot silently replace one already trusted by Runtime.
 *
 * TLS authenticates the initial pinned official endpoint. Operators can
 * additionally pin the SPKI SHA-256 via expectedFingerprint independently.
 * The local cache does not contain a signing key or any account secrets.
 */
export async function ensureRuntimeLeaseTrust({
  cloudBaseUrl=OFFICIAL_OWL_CLOUD_ORIGIN,
  filePath,
  expectedFingerprint=OFFICIAL_OWL_LEASE_SPKI_SHA256,
  fetchImpl=fetch,
  timeoutMs=8000,
}={}) {
  if (typeof filePath!=="string" || !path.isAbsolute(filePath)) {
    throw Error("RUNTIME_LEASE_TRUST_FILE_REQUIRED");
  }
  let installed=null;
  try { installed=parseVerifier(await fs.readFile(filePath,"utf8")); }
  catch (error) {
    if (error?.code!=="ENOENT") {
      // Do not silently replace a malformed local trust anchor.
      if (!installed) throw Error("RUNTIME_LEASE_TRUST_EXISTING_KEY_INVALID: "+error.message);
    }
  }
  const expected=expectedFingerprint?.trim().toLowerCase() || null;
  if (expected && !SHA256.test(expected)) throw Error("RUNTIME_LEASE_TRUST_EXPECTED_FINGERPRINT_INVALID");
  if (installed && expected && installed.fingerprint !== expected) {
    throw Error("RUNTIME_LEASE_TRUST_FINGERPRINT_MISMATCH: Local trust anchor differs from configured pin.");
  }
  let origin;
  try { origin=trustedCloudOrigin(cloudBaseUrl); }
  catch(error) {
    if(installed) return {status:"existing-external-anchor",fingerprint:installed.fingerprint};
    throw error;
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  let data;
  try {
    const response=await fetchImpl(origin+ENDPOINT,{
      method:"GET",
      redirect:"error",
      signal:controller.signal,
      headers:{accept:"application/json"},
    });
    if (!response.ok) throw Error("RUNTIME_LEASE_TRUST_FETCH_HTTP_"+response.status);
    const raw=await response.text();
    if(raw.length>8192) throw Error("RUNTIME_LEASE_TRUST_RESPONSE_TOO_LARGE");
    data=JSON.parse(raw);
  } catch(error) {
    if (installed) return {status:"existing-offline-anchor",fingerprint:installed.fingerprint};
    throw Error("RUNTIME_LEASE_TRUST_BOOTSTRAP_FAILED: Could not obtain the official verifier from "+origin+ENDPOINT+" ("+String(error?.message??error)+"). Keep signature checks enabled; the hosted Cloud must publish its public verifier.");
  } finally { clearTimeout(timeout); }

  if(data?.schemaVersion!==1 || data?.purpose!=="owl-runtime-lease-verification" ||
     data?.algorithm!=="Ed25519" || !SHA256.test(data?.spkiSha256)) {
    throw Error("RUNTIME_LEASE_TRUST_BAD_RESPONSE");
  }
  const official=parseVerifier(data.publicKeyPem);
  if(official.fingerprint!==data.spkiSha256) throw Error("RUNTIME_LEASE_TRUST_RESPONSE_FINGERPRINT_INVALID");
  if(expected && official.fingerprint!==expected) throw Error("RUNTIME_LEASE_TRUST_FINGERPRINT_MISMATCH");
  if(installed) {
    if(installed.fingerprint!==official.fingerprint) {
      throw Error("RUNTIME_LEASE_TRUST_ROTATION_REQUIRES_REVIEW: Hosted signing key differs from the installed trust anchor. Do not auto-replace it; verify the official rotation and SPKI fingerprint.");
    }
    return {status:"verified-existing",fingerprint:official.fingerprint};
  }

  const dir=path.dirname(filePath);
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  // Exclusive creation prevents racing installs and won't replace a symlink.
  let handle;
  try { handle=await fs.open(filePath,"wx",0o644); }
  catch(error) {
    if (error.code==="EEXIST") throw Error("RUNTIME_LEASE_TRUST_INSTALL_RACE: Recheck the existing trust anchor.");
    throw error;
  }
  try { await handle.writeFile(official.pem); }
  catch(error) {
    await handle.close();
    await fs.unlink(filePath).catch(()=>{});
    throw error;
  }
  await handle.close();
  return {status:"installed",fingerprint:official.fingerprint};
}
