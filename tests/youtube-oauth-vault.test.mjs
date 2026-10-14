import {vi,describe,it,expect} from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
vi.mock("electron",()=>({
 app:{getPath:()=>os.tmpdir()},
 safeStorage:{
  isEncryptionAvailable:()=>true,
  encryptString:value=>Buffer.from("OS_ENCRYPTED:"+value,"utf8"),
  decryptString:buffer=>buffer.toString("utf8").replace(/^OS_ENCRYPTED:/,""),
 },
}));
import {IdentityVault} from "../electron/services/identity-vault.mjs";
const channelId="UC"+"a".repeat(22);
const appId="123456-testdesktop.apps.googleusercontent.com";
describe("service identity OAuth credentials stay off renderer",()=>{
 it("encrypts the grant, clears password, invalidates if account changes",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-vault-test-"));
  const file=path.join(dir,"identities.json");
  try{
   const vault=new IdentityVault({file});
   const original=vault.upsert({service:"Google",label:"YouTube",identifier:"owner@example.com",
    authMethod:"password",secret:"SECRET_LEGACY_PASSWORD"});
   const failed=vault.noteYoutubeOauthAttempt(original.id,"YOUTUBE_OAUTH_SCOPES_MISSING");
   expect(failed.lastYoutubeOauthError).toBe("YOUTUBE_OAUTH_SCOPES_MISSING");
   expect(failed.status).toBe("needs_login");
   expect(vault.noteYoutubeOauthAttempt(original.id,"https://invalid.example?code=TOKEN").lastYoutubeOauthError)
    .toBe("YOUTUBE_OAUTH_CONNECTION_FAILED");
   const connected=vault.saveYoutubeGrant(original.id,{
    channelId,channelTitle:"Test Channel",verifiedEmail:"owner@example.com",
    grant:{refreshToken:"SECRET_REFRESH",accessToken:"SECRET_ACCESS",
     scopes:["youtube.upload"],expiresAt:new Date(Date.now()+30000).toISOString()},
   },appId);
   expect(connected.connectedTargetId).toBe(channelId);
   expect(connected.lastYoutubeOauthError).toBeNull();
   expect(connected.oauthCipherText).toBeUndefined();
   expect(connected.cipherText).toBeUndefined();
   expect(vault.list()[0].oauthCipherText).toBeUndefined();
   expect(vault.readSecret(original.id)).toBeUndefined();
   const raw=fs.readFileSync(file,"utf8");
   for(const secret of ["SECRET_REFRESH","SECRET_ACCESS","SECRET_LEGACY_PASSWORD"])
    expect(raw).not.toContain(secret);
   vault.upsert({...connected,identifier:"different@example.com"});
   expect(vault.get(original.id).status).toBe("needs_login");
   expect(vault.get(original.id).connectedTargetId).toBeNull();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
});
