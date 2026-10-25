import {describe,it,expect} from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createAgentUploadBroker} from "../connection-host/agent-upload-broker.mjs";
import {createNativeChromeBridge} from "../connection-host/native-user-chrome-bridge.mjs";
import {createNativeAgentExecutor} from "../chrome-agent-native/agent-executor.mjs";
import {discoverFileInputs,verifyFileInput,readFileInputSelection} from "../chrome-agent-native/file-inputs.mjs";
import {detectPageReceipt} from "../chrome-agent-native/download-workflow.mjs";

const OWNER="owl-test-session-1", SITE="https://example.com";
const fixtures=async(fn)=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),"owl-upload-test-"));
  const allowed=path.join(base,"allowed"),temp=path.join(base,"temp");
  await fs.mkdir(allowed);
  const file=path.join(allowed,"photo.png");
  await fs.writeFile(file,Buffer.from("fixture PNG bytes for unit test"));
  const broker=createAgentUploadBroker({allowedRoots:[allowed],allowedOrigins:[SITE],tempRoot:temp});
  try{await fn({base,allowed,file,broker,temp});}
  finally{await broker.close();await fs.rm(base,{recursive:true,force:true});}
};
describe("secure local upload staging",()=>{
 it("permits exact authorized roots, preserves filename, hashes bytes and denies foreign owner/site",async()=>{
  await fixtures(async({file,broker})=>{
    const prep=await broker.prepare({owner:OWNER,filePath:file,origin:SITE+"/upload"});
    expect(prep.filename).toBe("photo.png");
    expect(prep.mime).toBe("image/png");
    expect(prep.bytes).toBe(31);
    expect(prep.file_ticket).toMatch(/^[0-9a-f]{48}$/);
    const files=await broker.resolve({owner:OWNER,ticketIds:[prep.file_ticket],origin:SITE});
    expect(path.basename(files[0].stagedPath)).toBe("photo.png");
    expect(await fs.readFile(files[0].stagedPath)).toEqual(await fs.readFile(file));
    await expect(broker.resolve({owner:"owl-other",ticketIds:[prep.file_ticket],origin:SITE})).rejects.toThrow("UPLOAD_TICKET_NOT_AUTHORIZED");
    await expect(broker.resolve({owner:OWNER,ticketIds:[prep.file_ticket],origin:"https://attacker.com"})).rejects.toThrow("UPLOAD_TICKET_NOT_AUTHORIZED");
    const result=await broker.recordSelection({owner:OWNER,ticketIds:[prep.file_ticket],
      pageId:13,inputUid:"owl-file-0",origin:SITE,result:{pageId:13,selected:true,selectedCount:1}});
    expect(result.state).toBe("selected");
    expect(result.website_upload_verified).toBe(false);
    expect((await broker.status({owner:OWNER,uploadId:result.upload_id})).website_upload_verified).toBe(false);
    await expect(broker.status({owner:"other",uploadId:result.upload_id})).rejects.toThrow("UPLOAD_STATUS_NOT_FOUND");
    await expect(broker.resolve({owner:OWNER,ticketIds:[prep.file_ticket],origin:SITE})).rejects.toThrow("UPLOAD_TICKET_NOT_AUTHORIZED");
    expect((await broker.release({owner:"other",ticketIds:[prep.file_ticket]})).released).toBe(0);
    expect((await broker.release({owner:OWNER,ticketIds:[prep.file_ticket]})).released).toBe(1);
    await expect(fs.stat(files[0].stagedPath)).rejects.toMatchObject({code:"ENOENT"});
  });
 });
 it("file drop uses one-time owner+origin ticket; dispatch is not server proof",async()=>{
  await fixtures(async({file,broker})=>{
    const prepared=await broker.prepare({owner:OWNER,filePath:file,origin:SITE});
    await expect(broker.recordDrop({owner:OWNER,ticketIds:[prepared.file_ticket],
      pageId:13,targetUid:"owl-agent-1",origin:SITE,
      result:{dispatched:false,pageId:13,transferredCount:1}}))
      .rejects.toThrow("FILE_DROP_DISPATCH_UNCONFIRMED");
    const selected=await broker.recordDrop({owner:OWNER,ticketIds:[prepared.file_ticket],
      pageId:13,targetUid:"owl-agent-1",origin:SITE,
      result:{dispatched:true,pageId:13,transferredCount:1,domObserved:false}});
    expect(selected).toMatchObject({state:"dispatched_unconfirmed",website_upload_verified:false});
    await expect(broker.resolve({owner:OWNER,ticketIds:[prepared.file_ticket],origin:SITE}))
      .rejects.toThrow("UPLOAD_TICKET_NOT_AUTHORIZED");
    await expect(broker.status({owner:"other",uploadId:selected.upload_id}))
      .rejects.toThrow("UPLOAD_STATUS_NOT_FOUND");
  });
 });
 it("rejects outside root, secrets, symlink escapes, MIME mismatch and missing roots",async()=>{
  await fixtures(async({base,allowed,file,broker})=>{
    const outside=path.join(base,"outside.png");await fs.writeFile(outside,"x");
    await expect(broker.prepare({owner:OWNER,filePath:outside,origin:SITE})).rejects.toThrow("UPLOAD_FILE_OUTSIDE_ALLOWED_ROOTS");
    const secret=path.join(allowed,".env");await fs.writeFile(secret,"TOKEN=abc");
    await expect(broker.prepare({owner:OWNER,filePath:secret,origin:SITE})).rejects.toThrow("UPLOAD_FILE_TYPE_OR_PATH_NOT_ALLOWED");
    const link=path.join(allowed,"linked.png");
    let symlinkReady=false;
    try{await fs.symlink(outside,link);symlinkReady=true;}
    catch(error){
      // Non-admin Windows installations often lack SeCreateSymbolicLinkPrivilege.
      // No symlink was created, so the escape check cannot be exercised here.
      if(process.platform!=="win32"||!["EPERM","EACCES"].includes(error.code))throw error;
    }
    if(symlinkReady)
      await expect(broker.prepare({owner:OWNER,filePath:link,origin:SITE})).rejects.toThrow("UPLOAD_FILE_OUTSIDE_ALLOWED_ROOTS");
    await expect(broker.prepare({owner:OWNER,filePath:file,origin:"file:///etc/passwd"})).rejects.toThrow("UPLOAD_ORIGIN_INVALID");
    await expect(broker.prepare({owner:OWNER,filePath:file,origin:"https://evil.example"})).rejects.toThrow("UPLOAD_DESTINATION_NOT_APPROVED");
    const none=createAgentUploadBroker({allowedRoots:[],allowedOrigins:[SITE],tempRoot:path.join(base,"none")});
    await expect(none.prepare({owner:OWNER,filePath:file,origin:SITE})).rejects.toThrow("UPLOAD_ROOT_NOT_CONFIGURED");
    await none.close();
  });
 });
 it("removes expired staged files and rejects reused tickets",async()=>{
  await fixtures(async({file,base})=>{
    let tick=1000;
    const b=createAgentUploadBroker({allowedRoots:[path.dirname(file)],allowedOrigins:[SITE],
      tempRoot:path.join(base,"expiring"),ttlMs:1000,now:()=>tick});
    try{
      const p=await b.prepare({owner:OWNER,filePath:file,origin:SITE});
      const [f]=await b.resolve({owner:OWNER,ticketIds:[p.file_ticket],origin:SITE});
      tick=2100;
      await expect(b.resolve({owner:OWNER,ticketIds:[p.file_ticket],origin:SITE})).rejects.toThrow("UPLOAD_TICKET_NOT_AUTHORIZED");
      await expect(fs.stat(f.stagedPath)).rejects.toMatchObject({code:"ENOENT"});
    }finally{await b.close();}
  });
 });
});
function fakeExtension({emptyInputAfterUpload=false}={}) {
  const owned={};
  const calls=[];
  const storage={...owned};
  let currentFile={name:"photo.png"};
  const chrome={
    storage:{session:{get:async k=>({[k]:storage[k]}),set:async x=>Object.assign(storage,x)}},
    tabs:{
      create:async()=>({id:77,url:SITE+"/upload",active:false,windowId:1}),
      query:async()=>[],
      get:async(id)=>({id,url:SITE+"/upload",active:false,windowId:1}),
      remove:async()=>{}
    },
    scripting:{executeScript:async({func,args})=>{
      calls.push({name:func.name,args});
      if(func===discoverFileInputs)return [{result:{origin:SITE,url:SITE+"/upload",inputs:[
        {uid:"owl-file-0",hidden:true,accept:".png",multiple:false,disabled:false}]}}];
      if(func===verifyFileInput)return [{result:{valid:true}}];
      if(func===readFileInputSelection)return [{result:emptyInputAfterUpload?null:
        {selectedCount:1,fileNames:[currentFile.name]}}];
      if(func===detectPageReceipt)return [{result:{observed:true,origin:SITE}}];
      return [{result:{}}];
    }},
    debugger:{
      attach:async({tabId})=>calls.push({name:"attach",tabId}),
      sendCommand:async(_,method,args)=>{
        calls.push({name:method,args});
        if(method==="DOM.getDocument")return {root:{nodeId:11}};
        if(method==="DOM.querySelector")return {nodeId:12};
        return {};
      },
      detach:async({tabId})=>calls.push({name:"detach",tabId})
    }
  };
  return {chrome,storage:chrome.storage.session,calls};
}
describe("Agent-owned browser upload",()=>{
 it("recognizes filename UI receipt when an upload widget clears the file input",async()=>{
   await fixtures(async({file,broker})=>{
     const extension=fakeExtension({emptyInputAfterUpload:true});
     const executor=createNativeAgentExecutor(extension.chrome,extension.storage);
     await executor.run({owner:OWNER,op:"open",args:{url:SITE+"/upload"}});
     const req={status:()=>({connected:true}),
       request:(owner,op,args)=>executor.run({owner,op,args})};
     const bridge=createNativeChromeBridge({broker:req,uploadBroker:broker});
     const prepared=await bridge.prepareFile(OWNER,file);
     const result=await bridge.uploadFile(OWNER,{pageId:77,inputUid:"owl-file-0",
       fileTickets:[prepared.file_ticket]});
     expect(result.state).toBe("ui_observed");
     expect(result.website_upload_verified).toBe(false);
     expect((await bridge.uploadStatus(OWNER,result.upload_id)).state).toBe("ui_observed");
     expect(extension.calls.some(c=>c.name==="DOM.setFileInputFiles")).toBe(true);
   });
 });
 it("handles hidden standard input with temporary debugger attach, no foreground or native dialog",async()=>{
  const x=fakeExtension();
  const agent=createNativeAgentExecutor(x.chrome,x.storage);
  await agent.run({owner:OWNER,op:"open",args:{url:SITE+"/upload"}});
  const inputs=await agent.run({owner:OWNER,op:"file_inputs"});
  expect(inputs.inputs[0]).toMatchObject({uid:"owl-file-0",hidden:true});
  const files=[{stagedPath:"/tmp/owl-fixture/photo.png",filename:"photo.png"}];
  const result=await agent.run({owner:OWNER,op:"upload_file",args:{pageId:77,inputUid:"owl-file-0",origin:SITE,files}});
  expect(result).toMatchObject({pageId:77,selected:true,selectedCount:1,websiteUploadVerified:false});
  expect(x.calls.filter(c=>c.name==="DOM.setFileInputFiles")).toHaveLength(1);
  expect(x.calls.find(c=>c.name==="DOM.setFileInputFiles").args.files).toEqual([files[0].stagedPath]);
  expect(x.calls.map(x=>x.name)).toContain("detach");
  expect(x.calls.map(x=>x.name)).not.toContain("focus_login");
 });
 it("refuses cross-Session and mismatched page input before debugger attach",async()=>{
  const x=fakeExtension(),agent=createNativeAgentExecutor(x.chrome,x.storage);
  await agent.run({owner:OWNER,op:"open",args:{url:SITE+"/upload"}});
  const files=[{stagedPath:"/tmp/photo.png",filename:"photo.png"}];
  await expect(agent.run({owner:"owl-foreign",op:"upload_file",args:{pageId:77,inputUid:"owl-file-0",origin:SITE,files}})).rejects.toThrow("AGENT_TAB_NOT_OWNED");
  await expect(agent.run({owner:OWNER,op:"upload_file",args:{pageId:78,inputUid:"owl-file-0",origin:SITE,files}})).rejects.toThrow("UPLOAD_ARGUMENTS_INVALID");
  await expect(agent.run({owner:OWNER,op:"upload_file",args:{pageId:77,inputUid:"owl-file-0",origin:"https://wrong.example",files}})).rejects.toThrow("UPLOAD_ORIGIN_CHANGED");
  expect(x.calls.filter(c=>c.name==="attach")).toHaveLength(0);
 });
 it("prevents input accept mismatch before posting command to Chrome",async()=>{
  await fixtures(async({file,broker})=>{
    const extension=fakeExtension(),executor=createNativeAgentExecutor(extension.chrome,extension.storage);
    await executor.run({owner:OWNER,op:"open",args:{url:SITE+"/upload"}});
    const calls=[];
    const mockBroker={status:()=>({connected:true}),request:async(owner,op,args)=>{
      calls.push(op);return executor.run({owner,op,args});
    }};
    const bridge=createNativeChromeBridge({broker:mockBroker,uploadBroker:broker});
    const prep=await bridge.prepareFile(OWNER,file);
    const result=await bridge.uploadFile(OWNER,{pageId:77,inputUid:"owl-file-0",fileTickets:[prep.file_ticket]});
    expect(result.state).toBe("selected");
    expect(result.website_upload_verified).toBe(false);
    expect((await bridge.uploadStatus(OWNER,result.upload_id)).state).toBe("selected");
    expect(calls).toEqual(["file_inputs","file_inputs","upload_file"]);
    expect(await bridge.capabilities()).toMatchObject({fileUpload:{uploadFile:true,rootsConfigured:true}});
    expect(extension.calls.find(x=>x.name==="DOM.setFileInputFiles")).toBeTruthy();
  });
 });
});
