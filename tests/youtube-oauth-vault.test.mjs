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
   const renamed=vault.upsert({...connected,label:"Bloomroom Video"});
   expect(renamed.id).toBe(original.id);
   expect(renamed.status).toBe("ready");
   expect(renamed.connectedTargetId).toBe(channelId);
   expect(renamed.oauthCipherText).toBeUndefined();
   const unchanged=JSON.parse(fs.readFileSync(file,"utf8"))[0];
   expect(unchanged.oauthCipherText).toBeTruthy();
   expect(unchanged.lastAuthenticatedAt).toBe(connected.lastAuthenticatedAt);
   vault.upsert({...renamed,identifier:"different@example.com"});
   expect(vault.get(original.id).status).toBe("needs_login");
   expect(vault.get(original.id).connectedTargetId).toBeNull();
   expect(JSON.parse(fs.readFileSync(file,"utf8"))[0].oauthCipherText).toBeNull();
   expect(()=>vault.upsert({...connected,id:"missing-account-id"})).toThrow("ACCOUNT_EDIT_NOT_FOUND");
   const legacy=vault.upsert({service:"Example",label:"Original",identifier:"old@example.com",
    authMethod:"password",secret:"LEGACY_TEST_SECRET"});
   vault.upsert({...legacy,label:"Renamed",notes:"Edited in place"});
   expect(vault.readSecret(legacy.id)).toBe("LEGACY_TEST_SECRET");
   expect(vault.get(legacy.id).notes).toBe("Edited in place");
   vault.upsert({...legacy,label:"Renamed",secret:"REPLACEMENT_TEST_SECRET"});
   expect(vault.readSecret(legacy.id)).toBe("REPLACEMENT_TEST_SECRET");
   vault.upsert({...legacy,label:"Renamed",authMethod:"oauth"});
   expect(vault.readSecret(legacy.id)).toBeUndefined();
   expect(vault.get(legacy.id).status).toBe("needs_login");
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
});
