import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createAgentUploadBroker} from "../connection-host/agent-upload-broker.mjs";
import {changeUploadConsent,getUploadConsent,normalizeUploadOrigin,defaultUploadConsentFile} from "../shared/agent-upload-consent.mjs";

describe("owner-initiated file upload consent",()=>{
  it("requires exact origin, refuses non-HTTPS URLs and roots that are too broad",()=>{
    expect(normalizeUploadOrigin("https://jobs.ashbyhq.com")).toBe("https://jobs.ashbyhq.com");
    for(const url of ["https://jobs.ashbyhq.com/application","http://jobs.ashbyhq.com",
      "https://*.ashbyhq.com","https://evil.com@jobs.ashbyhq.com","https://jobs.ashbyhq.com?ok=1"])
      expect(()=>normalizeUploadOrigin(url)).toThrow("UPLOAD_ORIGIN_INVALID");
    expect(defaultUploadConsentFile({platform:"darwin",home:"/Users/me"})).toBe(
      "/Users/me/Library/Application Support/OWL LAB/desktop/agent-upload-consent.json");
  });
  it("defaults to deny, needs both site and root, revocation immediately invalidates staged files",async()=>{
    const base=fs.mkdtempSync(path.join(os.tmpdir(),"owl-owner-consent-"));
    const folder=path.join(base,"chosen"),other=path.join(base,"other");
    fs.mkdirSync(folder);fs.mkdirSync(other);
    const file=path.join(folder,"cv.pdf");fs.writeFileSync(file,"fake test PDF bytes");
    const policy=path.join(base,"secure","upload-policy.json");
    const read=()=>getUploadConsent({file:policy});
    const broker=createAgentUploadBroker({consentReader:read,scopeReader:()=>"",
      tempRoot:path.join(base,"staging")});
    const owner="test-owner",origin="https://jobs.ashbyhq.com";
    try{
      expect(read()).toEqual({roots:[],origins:[]});
      await broker.prepare({owner,filePath:file,origin});
      throw Error("Expected prepare to fail without consent");
    }catch(error){
      expect(error.message).toBe("UPLOAD_DESTINATION_NOT_APPROVED");
    }
    try{
      changeUploadConsent({file:policy,addOrigin:origin});
      await expect(broker.prepare({owner,filePath:file,origin})).rejects.toThrow("UPLOAD_ROOT_NOT_CONFIGURED");
      changeUploadConsent({file:policy,addRoot:folder});
      const original=read();
      expect(original).toEqual({roots:[fs.realpathSync(folder)],origins:[origin]});
      expect(fs.statSync(policy).mode&0o077).toBe(0);
      const outside=path.join(other,"other.pdf");fs.writeFileSync(outside,"other");
      await expect(broker.prepare({owner,filePath:outside,origin})).rejects.toThrow("UPLOAD_FILE_OUTSIDE_ALLOWED_ROOTS");
      const p=await broker.prepare({owner,filePath:file,origin});
      expect(p.filename).toBe("cv.pdf");
      expect((await broker.resolve({owner,ticketIds:[p.file_ticket],origin})).length).toBe(1);
      // Revocation is read dynamically by Host: prepared tickets cannot bypass it.
      changeUploadConsent({file:policy,removeRoot:folder});
      await expect(broker.resolve({owner,ticketIds:[p.file_ticket],origin})).rejects.toThrow("UPLOAD_ROOT_REVOKED");
      changeUploadConsent({file:policy,addRoot:folder});
      changeUploadConsent({file:policy,removeOrigin:origin});
      await expect(broker.resolve({owner,ticketIds:[p.file_ticket],origin})).rejects.toThrow("UPLOAD_DESTINATION_NOT_APPROVED");
      // Fail closed on malformed and world-readable consent files.
      fs.chmodSync(policy,0o644);
      expect(read()).toEqual({roots:[],origins:[]});
      fs.chmodSync(policy,0o600);
      fs.writeFileSync(policy,"invalid json");
      expect(read()).toEqual({roots:[],origins:[]});
      expect(()=>changeUploadConsent({file:policy,addRoot:os.homedir()})).toThrow("UPLOAD_ROOT_TOO_BROAD");
    }finally{await broker.close();fs.rmSync(base,{recursive:true,force:true});}
  });
});
