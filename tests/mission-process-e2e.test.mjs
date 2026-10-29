import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {afterEach,describe,it,expect} from "vitest";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {startOwlMcpHttpServer} from "../mcp/http-server.mjs";
import {PlannerContinuationStore} from "../electron/services/planner-continuation-store.mjs";

const cleanup=[];
afterEach(async()=>{while(cleanup.length)await cleanup.pop()();});
const parse=r=>JSON.parse(r.content.filter(x=>x.type==="text").map(x=>x.text).join("\n"));

describe("Existing Runtime permission settings govern agents without duplicate Mission approval",()=>{
  it("direct process, shell and file tools work under an unsigned workstream, with no extra Mission signature",async()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"owl-direct-agent-"));
    cleanup.push(()=>fs.rmSync(tmp,{recursive:true,force:true}));
    const root=path.join(tmp,"workspace");
    fs.mkdirSync(root,{recursive:true});
    const store=new PlannerContinuationStore({file:path.join(tmp,"planner-continuation.json")});
    const forwarded=[];
    const backend=http.createServer(async(req,res)=>{
      let raw="";for await(const chunk of req)raw+=chunk;
      const call=JSON.parse(raw);
      forwarded.push(call);
      const primitive=call.params?.primitive;
      const op=call.params?.op;
      const result=primitive==="process.manage"&&op==="start"
        ? {processId:"process-test-native",running:true}
        : primitive==="sys.exec" ? {stdout:"NO_SECOND_APPROVAL",exitCode:0}
        : {ok:true};
      res.writeHead(200,{"content-type":"application/json"});
      res.end(JSON.stringify({ok:true,apiVersion:"0.1",result}));
    });
    await new Promise(resolve=>backend.listen(0,"127.0.0.1",resolve));
    cleanup.push(()=>new Promise(resolve=>backend.close(resolve)));
    const server=await startOwlMcpHttpServer({
      port:0,runtimeBaseUrl:"http://127.0.0.1:"+backend.address().port,
      plannerContinuation:store,
    });
    cleanup.push(()=>server.close());
    const transport=new StreamableHTTPClientTransport(new URL(server.url));
    cleanup.push(()=>transport.close().catch(()=>undefined));
    const client=new Client({name:"already-authorized-agent",version:"0.1.0"});
    await client.connect(transport);
    const opened=await client.callTool({name:"workstream_open",arguments:{
      goal:"Continue an existing user-authorized coding task",
      workspace:{repo:"workspace",worktree:root},
      mission_contract:{allowed_repositories:["workspace"],
        prohibited_changes:["Do not alter production"]},
    }});
    expect(opened.isError).not.toBe(true);
    const id=Object.keys(store.read().owners)[0];
    expect(store.get(id).workstream.missionContract.approval).toBeUndefined();
    const invoke=(name,args)=>client.callTool({name,arguments:{
      workstream_id:id,...args,
    }});
    const started=await invoke("start_process",{
      command:"printf 'already approved' ",cwd:root,workspace_mode:"write",
    });
    expect(started.isError).not.toBe(true);
    expect(parse(started)).toMatchObject({processId:"process-test-native",running:true});
    const cmd=await invoke("execute_command",{
      command:"printf 'shell allowed by Runtime'",cwd:root,
    });
    expect(cmd.isError).not.toBe(true);
    const write=await invoke("write_file",{
      path:path.join(root,"report.txt"),content:"test",overwrite:false,
    });
    expect(write.isError).not.toBe(true);
    expect(forwarded.some(c=>c.params?.primitive==="process.manage"&&c.params?.op==="start")).toBe(true);
    expect(forwarded.some(c=>c.params?.primitive==="sys.exec"&&c.params?.op==="run")).toBe(true);
    expect(forwarded.some(c=>c.params?.primitive==="fs.write")).toBe(true);
    expect(store.get(id).workstream.missionContract.approval).toBeUndefined();
  });

  it("no longer mounts redundant Mission approval UI in OWL Settings",()=>{
    const source=fs.readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
    expect(source).not.toContain("<MissionReviewPanel");
    expect(source).not.toContain('import { MissionReviewPanel }');
  });

  it("never overrides upstream Runtime permission refusals",async()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"owl-runtime-deny-"));
    cleanup.push(()=>fs.rmSync(tmp,{recursive:true,force:true}));
    const store=new PlannerContinuationStore({file:path.join(tmp,"planner-continuation.json")});
    const backend=http.createServer(async(req,res)=>{
      let raw="";for await(const chunk of req)raw+=chunk;
      const call=JSON.parse(raw);
      const denied=call.params?.primitive==="process.manage"&&call.params?.op==="start";
      res.writeHead(denied?403:200,{"content-type":"application/json"});
      res.end(denied?JSON.stringify({ok:false,error:{code:"RUNTIME_SHELL_DISABLED",
        message:"Shell Off in Runtime settings"}})
        :JSON.stringify({ok:true,apiVersion:"0.1",result:{ok:true}}));
    });
    await new Promise(resolve=>backend.listen(0,"127.0.0.1",resolve));
    cleanup.push(()=>new Promise(resolve=>backend.close(resolve)));
    const server=await startOwlMcpHttpServer({
      port:0,runtimeBaseUrl:"http://127.0.0.1:"+backend.address().port,
      plannerContinuation:store,
    });
    cleanup.push(()=>server.close());
    const transport=new StreamableHTTPClientTransport(new URL(server.url));
    cleanup.push(()=>transport.close().catch(()=>undefined));
    const client=new Client({name:"runtime-policy-test",version:"0.1.0"});
    await client.connect(transport);
    const r=await client.callTool({name:"start_process",arguments:{
      command:"echo test",cwd:tmp,workspace_mode:"write",
    }});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("RUNTIME_SHELL_DISABLED");
  });
});
