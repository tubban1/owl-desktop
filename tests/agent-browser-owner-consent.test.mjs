import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createAgentUploadBroker} from "../connection-host/agent-upload-broker.mjs";
import {changeUploadConsent,getUploadConsent,defaultUploadConsentFile} from "../shared/agent-upload-consent.mjs";

describe("owner-approved upload source folders",()=>{
  it("keeps local consent file location unchanged",()=>{
    expect(defaultUploadConsentFile({platform:"darwin",home:"/Users/me"})).toBe(
      "/Users/me/Library/Application Support/OWL LAB/desktop/agent-upload-consent.json");
  });
  it("allows arbitrary HTTPS targets once source folder is approved; revocation invalidates tickets",async()=>{
    const base=fs.mkdtempSync(path.join(os.tmpdir(),"owl-owner-consent-"));
    const folder=path.join(base,"chosen"),other=path.join(base,"other");
    fs.mkdirSync(folder);fs.mkdirSync(other);
    const file=path.join(folder,"film.mp4");fs.writeFileSync(file,"fake video bytes");
    const policy=path.join(base,"secure","upload-policy.json");
    const read=()=>getUploadConsent({file:policy});
    const broker=createAgentUploadBroker({consentReader:read,scopeReader:()=>"",
      tempRoot:path.join(base,"staging")});
    const owner="test-owner",origin="https://creator.douyin.com",another="https://creator.xiaohongshu.com";
    try{
      expect(read()).toEqual({roots:[]});
      await expect(broker.prepare({owner,filePath:file,origin})).rejects.toThrow("UPLOAD_ROOT_NOT_CONFIGURED");
      changeUploadConsent({file:policy,addRoot:folder});
      expect(read()).toEqual({roots:[fs.realpathSync(folder)]});
      expect(fs.statSync(policy).mode&0o077).toBe(0);
      expect(JSON.parse(fs.readFileSync(policy,"utf8"))).toMatchObject({version:2});
      const outside=path.join(other,"other.mp4");fs.writeFileSync(outside,"other");
      await expect(broker.prepare({owner,filePath:outside,origin})).rejects.toThrow("UPLOAD_FILE_OUTSIDE_ALLOWED_ROOTS");
      const p=await broker.prepare({owner,filePath:file,origin});
      expect((await broker.resolve({owner,ticketIds:[p.file_ticket],origin})).length).toBe(1);
      await expect(broker.resolve({owner,ticketIds:[p.file_ticket],origin:another})).rejects.toThrow("UPLOAD_TICKET_NOT_AUTHORIZED");
      const q=await broker.prepare({owner,filePath:file,origin:another});
      expect(q.destination_origin).toBe(another);
      expect(broker.capabilities()).toMatchObject({rootsConfigured:true,destinationsConfigured:true,destinationPolicy:"any_https"});
      await expect(broker.prepare({owner,filePath:file,origin:"http://example.com"})).rejects.toThrow("UPLOAD_ORIGIN_INVALID");
      changeUploadConsent({file:policy,removeRoot:folder});
      await expect(broker.resolve({owner,ticketIds:[p.file_ticket],origin})).rejects.toThrow("UPLOAD_ROOT_REVOKED");
      fs.chmodSync(policy,0o644);
      expect(read()).toEqual({roots:[]});
      fs.chmodSync(policy,0o600);
      fs.writeFileSync(policy,"invalid json");
      expect(read()).toEqual({roots:[]});
      expect(()=>changeUploadConsent({file:policy,addRoot:os.homedir()})).toThrow("UPLOAD_ROOT_TOO_BROAD");
    }finally{await broker.close();fs.rmSync(base,{recursive:true,force:true});}
  });
  it("retains previously approved folders but ignores former destination whitelist entries",async()=>{
    const base=fs.mkdtempSync(path.join(os.tmpdir(),"owl-source-migration-"));
    const policy=path.join(base,"policy.json"),folder=path.join(base,"approved");
    fs.mkdirSync(folder);
    fs.writeFileSync(policy,JSON.stringify({version:1,roots:[folder],origins:["https://old.example"]}),{mode:0o600});
    const read=getUploadConsent({file:policy});
    expect(read).toEqual({roots:[folder]});
    const file=path.join(folder,"demo.mp4");fs.writeFileSync(file,"video");
    const broker=createAgentUploadBroker({consentReader:()=>getUploadConsent({file:policy}),
      scopeReader:()=>"",tempRoot:path.join(base,"stage")});
    try{
      const selected=await broker.prepare({owner:"agent",filePath:file,origin:"https://new.example"});
      expect(selected.destination_origin).toBe("https://new.example");
    }finally{await broker.close();fs.rmSync(base,{recursive:true,force:true});}
  });
});
