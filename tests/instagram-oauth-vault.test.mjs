import {vi,describe,it,expect} from "vitest";
import os from "node:os";import fs from "node:fs";import path from "node:path";
vi.mock("electron",()=>({
 app:{getPath:()=>os.tmpdir()},
 safeStorage:{
   isEncryptionAvailable:()=>true,
   encryptString:v=>Buffer.from("OS_ENCRYPTED:"+v,"utf8"),
   decryptString:b=>b.toString("utf8").replace(/^OS_ENCRYPTED:/,"")
 }
}));
import {IdentityVault} from "../electron/services/identity-vault.mjs";
describe("Instagram grants OS-encrypted and account-locked",()=>{
 it("encrypts grant; label edits preserve and identity changes clear",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-instagram-vault-"));
  try{
   const file=path.join(dir,"accounts.json");const vault=new IdentityVault({file});
   const account=vault.upsert({service:"Instagram",label:"Bloomroom Lab",
     identifier:"@bloomroom.lab",authMethod:"oauth"});
   const attempt=vault.noteInstagramOauthAttempt(account.id,"INSTAGRAM_OAUTH_PROFILE_HTTP_403");
   expect(attempt.lastInstagramOauthError).toBe("INSTAGRAM_OAUTH_PROFILE_HTTP_403");
   const verified={accountId:"12345678901234567",username:"bloomroom.lab",
     grant:{accessToken:"SECRET_TEST_INSTAGRAM_LONG",
       expiresAt:new Date(Date.now()+5184000000).toISOString(),
       scopes:["instagram_business_basic","instagram_business_content_publish"]}};
   const ready=vault.saveInstagramGrant(account.id,verified,"123456789012345");
   expect(ready.status).toBe("ready");
   expect(ready.connectedProvider).toBe("instagram");
   expect(ready.connectedTargetTitle).toBe("@bloomroom.lab");
   expect(ready.lastInstagramOauthError).toBeNull();
   const raw=fs.readFileSync(file,"utf8");
   expect(raw).not.toContain("SECRET_TEST_INSTAGRAM_LONG");
   expect(raw).toContain("oauthCipherText");
   const rename=vault.upsert({...ready,label:"Bloomroom Creative"});
   expect(rename.status).toBe("ready");
   expect(rename.connectedTargetId).toBe(verified.accountId);
   const changed=vault.upsert({...rename,identifier:"@another.brand"});
   expect(changed.status).toBe("needs_login");
   expect(changed.connectedTargetId).toBeNull();
   expect(JSON.parse(fs.readFileSync(file,"utf8"))[0].oauthCipherText).toBeNull();
   expect(()=>vault.saveInstagramGrant(account.id,verified,"123456789012345")).toThrow("INSTAGRAM_OAUTH_WRONG_ACCOUNT");
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
});
