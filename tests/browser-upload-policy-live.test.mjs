import {describe,it,expect} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createAgentUploadBroker} from "../connection-host/agent-upload-broker.mjs";
import {readWindowsUserUploadSetting,currentUploadScope} from "../connection-host/agent-upload-policy.mjs";
import {isNativeAbsoluteStagePath} from "../chrome-agent-native/agent-executor.mjs";

describe("Windows owner-approved upload folder policy",()=>{
  it("reads exact HKCU folder scope and ignores removed website scope",()=>{
    const fake=(bin,args)=>{
      expect(bin).toBe("reg.exe");
      expect(args).toEqual(["query","HKCU\\Environment","/v","OWL_AGENT_UPLOAD_ROOTS"]);
      return "\r\n    OWL_AGENT_UPLOAD_ROOTS    REG_SZ    C:\\Users\\i95i\\Documents\r\n";
    };
    expect(readWindowsUserUploadSetting("OWL_AGENT_UPLOAD_ROOTS",{
      platform:"win32",runner:fake
    })).toBe("C:\\Users\\i95i\\Documents");
    expect(readWindowsUserUploadSetting("OWL_AGENT_UPLOAD_ORIGINS",{
      platform:"win32",runner:fake
    })).toBeUndefined();
    expect(currentUploadScope("OWL_AGENT_UPLOAD_ROOTS",{platform:"win32",env:{},
      readRegistry:()=> "D:\\Movies"})).toBe("D:\\Movies");
  });
  it("accepts any HTTPS destination, but never cross-uses owner-bound, origin-bound tickets",async()=>{
    const base=await fs.mkdtemp(path.join(os.tmpdir(),"owl-registry-scope-"));
    const root=path.join(base,"authorized");await fs.mkdir(root);
    const file=path.join(root,"clip.mp4");await fs.writeFile(file,"fake video fixture");
    const broker=createAgentUploadBroker({
      scopeReader:name=>name==="OWL_AGENT_UPLOAD_ROOTS"?root:"",
      tempRoot:path.join(base,"stage")
    });
    try{
      const one=await broker.prepare({owner:"job-agent",filePath:file,
        origin:"https://creator.douyin.com/upload"});
      const two=await broker.prepare({owner:"job-agent",filePath:file,
        origin:"https://creator.xiaohongshu.com/publish"});
      expect(one.destination_origin).toBe("https://creator.douyin.com");
      expect(two.destination_origin).toBe("https://creator.xiaohongshu.com");
      expect(broker.capabilities()).toMatchObject({rootsConfigured:true,destinationsConfigured:true,
        destinationPolicy:"any_https"});
      await expect(broker.resolve({owner:"job-agent",ticketIds:[one.file_ticket],
        origin:two.destination_origin})).rejects.toThrow("UPLOAD_TICKET_NOT_AUTHORIZED");
      await expect(broker.resolve({owner:"another-agent",ticketIds:[one.file_ticket],
        origin:one.destination_origin})).rejects.toThrow("UPLOAD_TICKET_NOT_AUTHORIZED");
      expect((await broker.resolve({owner:"job-agent",ticketIds:[two.file_ticket],
        origin:two.destination_origin}))[0].filename).toBe("clip.mp4");
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
