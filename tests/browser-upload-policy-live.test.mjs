import {describe,it,expect} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createAgentUploadBroker} from "../connection-host/agent-upload-broker.mjs";
import {readWindowsUserUploadSetting,currentUploadScope} from "../connection-host/agent-upload-policy.mjs";
import {isNativeAbsoluteStagePath} from "../chrome-agent-native/agent-executor.mjs";

describe("Windows owner-approved file upload policy",()=>{
  it("reads exact HKCU values without making an agent-editable policy",()=>{
    const fake=(bin,args)=>{
      expect(bin).toBe("reg.exe");
      expect(args).toEqual(["query","HKCU\\Environment","/v","OWL_AGENT_UPLOAD_ORIGINS"]);
      return "\r\n    OWL_AGENT_UPLOAD_ORIGINS    REG_SZ    https://creator.douyin.com,https://careers.axpo.com\r\n";
    };
    expect(readWindowsUserUploadSetting("OWL_AGENT_UPLOAD_ORIGINS",{
      platform:"win32",runner:fake
    })).toBe("https://creator.douyin.com,https://careers.axpo.com");
    expect(readWindowsUserUploadSetting("UNSAFE_CUSTOM_NAME",{platform:"win32",runner:fake})).toBeUndefined();
    expect(currentUploadScope("OWL_AGENT_UPLOAD_ORIGINS",{platform:"win32",env:{},
      readRegistry:()=> "https://careers.axpo.com"})).toBe("https://careers.axpo.com");
  });
  it("updates exact site approvals without restarting Host and revokes outstanding tickets",async()=>{
    const base=await fs.mkdtemp(path.join(os.tmpdir(),"owl-registry-scope-"));
    const root=path.join(base,"authorized");await fs.mkdir(root);
    const file=path.join(root,"cv.pdf");await fs.writeFile(file,"fake PDF fixture");
    const temp=path.join(base,"stage");
    let origins="https://creator.douyin.com";
    const read=name=>name==="OWL_AGENT_UPLOAD_ORIGINS"?origins:root;
    const broker=createAgentUploadBroker({scopeReader:read,tempRoot:temp});
    try{
      await expect(broker.prepare({owner:"job-agent",filePath:file,origin:"https://careers.axpo.com"}))
        .rejects.toThrow("UPLOAD_DESTINATION_NOT_APPROVED");
      origins+=",https://careers.axpo.com";
      const prepared=await broker.prepare({owner:"job-agent",filePath:file,
        origin:"https://careers.axpo.com/jobs/8585631"});
      expect(prepared.filename).toBe("cv.pdf");
      expect(broker.capabilities()).toMatchObject({rootsConfigured:true,destinationsConfigured:true});
      origins="https://creator.douyin.com";
      await expect(broker.resolve({owner:"job-agent",ticketIds:[prepared.file_ticket],
        origin:"https://careers.axpo.com"})).rejects.toThrow("UPLOAD_DESTINATION_NOT_APPROVED");
    }finally{await broker.close();await fs.rm(base,{recursive:true,force:true});}
  });
  it("accepts Windows drive paths and POSIX paths but rejects relative/UNC paths",()=>{
    expect(isNativeAbsoluteStagePath("C:\\Users\\i95i\\AppData\\Local\\Temp\\cv.pdf")).toBe(true);
    expect(isNativeAbsoluteStagePath("D:\\cv.pdf")).toBe(true);
    expect(isNativeAbsoluteStagePath("/tmp/cv.pdf")).toBe(true);
    expect(isNativeAbsoluteStagePath("cv.pdf")).toBe(false);
    expect(isNativeAbsoluteStagePath("..\\cv.pdf")).toBe(false);
    expect(isNativeAbsoluteStagePath("\\\\server\\share\\cv.pdf")).toBe(false);
    expect(isNativeAbsoluteStagePath("C:cv.pdf")).toBe(false);
    expect(isNativeAbsoluteStagePath("C:\\cv.pdf\u0000.txt")).toBe(false);
  });
});
