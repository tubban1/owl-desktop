import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {generateKeyPairSync,sign} from "node:crypto";
import {afterEach,describe,it,expect} from "vitest";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {startOwlMcpHttpServer} from "../mcp/http-server.mjs";
import {PlannerContinuationStore} from "../electron/services/planner-continuation-store.mjs";
import {missionApprovalScope,missionApprovalMessage} from "../electron/services/mission-approval.mjs";

const cleanup=[];
afterEach(async()=>{while(cleanup.length)await cleanup.pop()();});
const parse=r=>JSON.parse(r.content.filter(x=>x.type==="text").map(x=>x.text).join("\n"));

describe("MCP-proposed permission → exact Desktop signature → runtime execution",()=>{
  it("never executes an unapproved program; approved fixed command is observable and tamper resistant",async()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"owl-mcp-signed-policy-"));
    cleanup.push(()=>fs.rmSync(tmp,{recursive:true,force:true}));
    const root=path.join(tmp,"workspace"),output=path.join(root,"artifacts");
    const executable=path.join(tmp,"tools","example-cli");
    fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.dirname(executable),{recursive:true});
    fs.writeFileSync(executable,"#!/bin/sh\nexit 0\n");fs.chmodSync(executable,0o700);
    const permission={
      id:"exact-artist",executable,cwd:output,
      argv:["--sandbox","workspace-write","-C",output,"build","test-sha"],
      workspace_mode:"write",writable_roots:[output],
      sandbox:{type:"tool-native",required_argv_segments:[["--sandbox","workspace-write"],["-C",output]]},
    };
    const store=new PlannerContinuationStore({file:path.join(tmp,"planner-continuation.json")});
    const {privateKey,publicKey}=generateKeyPairSync("ed25519");
    fs.writeFileSync(path.join(tmp,"human-approval-signer.json"),JSON.stringify({
      publicKeyB64:publicKey.export({format:"der",type:"spki"}).toString("base64"),
    }));
    const backendCalls=[];
    const runtime=http.createServer(async(req,res)=>{
      let raw="";for await(const chunk of req)raw+=chunk;
      const request=JSON.parse(raw);backendCalls.push(request);
      const op=request.params?.op;
      const value=op==="list"?[]:op==="start"?{
        processId:"process-test-approved",running:true,
      }:{ok:true};
      res.writeHead(200,{"content-type":"application/json"});
      res.end(JSON.stringify({ok:true,apiVersion:"0.1",result:value}));
    });
    await new Promise(resolve=>runtime.listen(0,"127.0.0.1",resolve));
    cleanup.push(()=>new Promise(resolve=>runtime.close(resolve)));
    const server=await startOwlMcpHttpServer({
      port:0,runtimeBaseUrl:"http://127.0.0.1:"+runtime.address().port,
      plannerContinuation:store,
    });
    cleanup.push(()=>server.close());
    const transport=new StreamableHTTPClientTransport(new URL(server.url));
    cleanup.push(()=>transport.close().catch(()=>undefined));
    const client=new Client({name:"permission-end-to-end-test",version:"0.1.0"});
    await client.connect(transport);
    const opened=await client.callTool({name:"workstream_open",arguments:{
      goal:"Finish one isolated art candidate",
      workspace:{repo:"workspace",worktree:root},
      mission_contract:{
        allowed_repositories:["workspace"],
        prohibited_changes:["Do not touch production"],
        execution_permissions:[permission],
      },
    }});
    expect(opened.isError).not.toBe(true);
    const id=Object.keys(store.read().owners)[0];
    const invoke=(name,args)=>client.callTool({name,arguments:{
      workstream_id:id,...args,
    }});
    const before=backendCalls.length;
    expect(parse(await invoke("mission_process_start",{permission_id:"exact-artist"})).code)
      .toBe("MISSION_APPROVAL_REQUIRED");
    expect(backendCalls.length).toBe(before);
    const owner=store.get(id);
    expect(owner.workstream.missionContract.executionPermissions[0])
      .toMatchObject({id:"exact-artist",executable,cwd:output});
    const scope=missionApprovalScope(owner);
    const signature=sign(null,Buffer.from(missionApprovalMessage(scope)),privateKey).toString("base64");
    store.attachMissionApproval(id,signature);
    const result=await invoke("mission_process_start",{permission_id:"exact-artist"});
    expect(result.isError).not.toBe(true);
    expect(parse(result)).toMatchObject({
      missionScoped:true,permissionId:"exact-artist",processId:"process-test-approved",
      confinementVerifiedByRuntime:false,
    });
    const started=backendCalls.find(x=>x.params?.op==="start");
    expect(started).toBeTruthy();
    expect(started.params.args.command).toContain("'--sandbox' 'workspace-write'");
    expect(started.params.args.cwd).toBe(fs.realpathSync(output));
    expect(parse(await invoke("start_process",{
      command:started.params.args.command+" ; unwanted",
      cwd:output,workspace_mode:"write",
    })).code).toBe("MISSION_OPAQUE_ACTION_BLOCKED");
    expect(backendCalls.filter(x=>x.params?.op==="start")).toHaveLength(1);
  });
});
