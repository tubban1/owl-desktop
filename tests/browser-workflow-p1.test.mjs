import {describe,it,expect} from "vitest";
import {createNativeAgentExecutor} from "../chrome-agent-native/agent-executor.mjs";
import {createNativeChromeBridge} from "../connection-host/native-user-chrome-bridge.mjs";

function fakeChrome(){
  const data={};
  const calls=[];
  let downloadState="in_progress";
  const chrome={
    storage:{session:{
      get:async key=>({[key]:data[key]}),
      set:async next=>Object.assign(data,next)
    }},
    tabs:{
      query:async()=>[],
      create:async args=>{calls.push(["create",args]);return {id:44,url:args.url,active:false,windowId:1};},
      get:async id=>({id,url:"https://files.example.com/report.pdf",windowId:1}),
      remove:async()=>{}
    },
    scripting:{executeScript:async({func})=>{
      if(func.name==="inspectAgentDownloadLink")return [{result:{
        url:"https://files.example.com/report.pdf",filename:"report.pdf"
      }}];
      if(func.name==="detectPageReceipt")return [{result:{observed:true,origin:"https://files.example.com"}}];
      if(func.name==="discoverFileInputs")return [{result:{
        pageId:44,origin:"https://files.example.com",inputs:[{uid:"owl-file-0",multiple:false,accept:".pdf",disabled:false}]
      }}];
      return [{result:{}}];
    }},
    downloads:{
      download:async args=>{calls.push(["download",args]);return 812;},
      search:async({id})=>[{id,filename:"/Users/test/Downloads/OWL LAB/report.pdf",
        state:downloadState,bytesReceived:downloadState==="complete"?60:8,totalBytes:60}],
      cancel:async id=>{calls.push(["cancel",id]);downloadState="interrupted";}
    }
  };
  return {chrome,calls,session:chrome.storage.session,setState:x=>downloadState=x};
}
describe("OWL browser P1 downloads",()=>{
 it("downloads same-origin link in the existing Chrome profile and de-duplicates a request",async()=>{
   const f=fakeChrome(),x=createNativeAgentExecutor(f.chrome,f.session);
   await x.run({owner:"agent-A",op:"open",args:{url:"https://files.example.com/report.pdf"}});
   const args={linkUid:"owl-agent-0",requestId:"f89fb2c3-6644-4bf7-960d-b74835f10e54"};
   const a=await x.run({owner:"agent-A",op:"download_start",args});
   const b=await x.run({owner:"agent-A",op:"download_start",args});
   expect(a.download_id).toBe(812);
   expect(b.download_id).toBe(812);
   expect(f.calls.filter(x=>x[0]==="download")).toHaveLength(1);
   expect(f.calls.find(x=>x[0]==="download")[1]).toMatchObject({
     saveAs:false,filename:"OWL LAB/report.pdf",conflictAction:"uniquify"
   });
   expect((await x.run({owner:"agent-A",op:"download_list"})).downloads).toHaveLength(1);
   await expect(x.run({owner:"agent-B",op:"download_status",args:{downloadId:812}})).rejects.toThrow("AGENT_TAB_NOT_OWNED");
   expect((await x.run({owner:"agent-A",op:"download_status",args:{downloadId:812}})).completed).toBe(false);
   f.setState("complete");
   const completed=await x.run({owner:"agent-A",op:"download_status",args:{downloadId:812}});
   expect(completed).toMatchObject({state:"complete",completed:true,filename:"report.pdf"});
   expect(completed).not.toHaveProperty("localPath");
   expect((await x.run({owner:"agent-A",op:"download_artifact",args:{downloadId:812}})).localPath).toMatch(/report.pdf$/);
   expect((await x.run({owner:"agent-A",op:"receipt_check",args:{expectedText:"Upload succeeded"}})).state).toBe("ui_observed");
 });
 it("cancels only own incomplete download",async()=>{
   const f=fakeChrome(),x=createNativeAgentExecutor(f.chrome,f.session);
   await x.run({owner:"agent-A",op:"open",args:{url:"https://files.example.com/report.pdf"}});
   await x.run({owner:"agent-A",op:"download_start",
     args:{linkUid:"owl-agent-0",requestId:"57b2a7e3-e7e1-4e3c-b6d6-cf82a9e2495b"}});
   const result=await x.run({owner:"agent-A",op:"download_cancel",args:{downloadId:812}});
   expect(result.cancel_requested).toBe(true);
   expect(f.calls).toContainEqual(["cancel",812]);
 });
 it("download to upload never bypasses destination and directory authorization",async()=>{
   const f=fakeChrome(),executor=createNativeAgentExecutor(f.chrome,f.session);
   await executor.run({owner:"agent-A",op:"open",args:{url:"https://files.example.com/report.pdf"}});
   const request=async(owner,op,args)=>executor.run({owner,op,args});
   const calls=[];
   const uploadBroker={prepare:async input=>{calls.push(input);return {file_ticket:"token"};}};
   const bridge=createNativeChromeBridge({broker:{request,status:()=>({connected:true})},uploadBroker});
   await bridge.downloadStart("agent-A","owl-agent-0","f89fb2c3-6644-4bf7-960d-b74835f10e54");
   await expect(bridge.prepareDownload("agent-A",812)).rejects.toThrow("DOWNLOAD_NOT_COMPLETE");
   f.setState("complete");
   const t=await bridge.prepareDownload("agent-A",812);
   expect(t.file_ticket).toBe("token");
   expect(calls[0]).toMatchObject({owner:"agent-A",
     origin:"https://files.example.com",filePath:"/Users/test/Downloads/OWL LAB/report.pdf"});
 });
});
