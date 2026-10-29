import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";
import {
  missionApprovalMessage, missionApprovalScope, missionApprovalStatus,
  withinMissionRoot,
} from "../electron/services/mission-approval.mjs";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
const cleaners=[];
afterEach(async()=>{while(cleaners.length)await cleaners.pop()?.();});
const parse=(r)=>JSON.parse(r.content.filter(p=>p.type==="text").map(p=>p.text).join("\n"));

describe("Historical mission signatures are audit-only, not an extra execution gate",()=>{
 it("retains old signed audit history but forwards agent operations to the existing Runtime authority",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-mission-guard-"));
  cleaners.push(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const root=path.join(dir,"vibe-monitor");
  const outside=path.join(dir,"outside");
  fs.mkdirSync(root);fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(root,"escape"));
  const store=new PlannerContinuationStore({file:path.join(dir,"planner-continuation.json")});
  const original=store.openWorkstream({
    goal:"Validate Vibe Monitor 1.0.1",
    clientKind:"chatgpt",
    workspace:{repo:"vibe-monitor",worktree:root},
    missionContract:{
      allowedRepositories:["vibe-monitor"],
      prohibitedChanges:["Never create Beta42"],
      acceptanceCriteria:["Verify existing release"],
    },
  });
  const id=original.ownerId;
  const {privateKey, publicKey}=generateKeyPairSync("ed25519");
  const keyB64=publicKey.export({format:"der",type:"spki"}).toString("base64");
  fs.writeFileSync(path.join(dir,"human-approval-signer.json"),JSON.stringify({publicKeyB64:keyB64}));
  const data=store.get(id);
  const scope=missionApprovalScope(data);
  expect(missionApprovalStatus(data,path.join(dir,"human-approval-signer.json")).approved).toBe(false);
  expect(withinMissionRoot(root,path.join(root,"ok.txt"))).toBe(true);
  expect(withinMissionRoot(root,path.join(root,"escape","bad.txt"))).toBe(false);
  expect(withinMissionRoot(root,path.join(outside,"bad.txt"))).toBe(false);
  const signed=sign(null,Buffer.from(missionApprovalMessage(scope)),privateKey).toString("base64");
  expect(()=>store.attachMissionApproval(id,"fake")).toThrow("MISSION_SIGNATURE_INVALID");

  const invoked=[];
  const mock=http.createServer(async(req,res)=>{
    let payload="";for await(const chunk of req)payload+=chunk;
    const request=JSON.parse(payload);invoked.push(request.method);
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({ok:true,apiVersion:"0.1",result:{called:request.method}}));
  });
  await new Promise(resolve=>mock.listen(0,"127.0.0.1",resolve));
  cleaners.push(()=>new Promise(resolve=>mock.close(resolve)));
  const server=await startOwlMcpHttpServer({port:0,
    runtimeBaseUrl:"http://127.0.0.1:"+mock.address().port,
    plannerContinuation:store,
  });
  cleaners.push(()=>server.close());
  const transport=new StreamableHTTPClientTransport(new URL(server.url));
  cleaners.push(()=>transport.close().catch(()=>undefined));
  const client=new Client({name:"mission-scope-review",version:"0.1.0"});
  await client.connect(transport);
  const tool=(name,args)=>client.callTool({name,arguments:{workstream_id:id,...args}});
  const before=invoked.length;
  // The user already enabled Runtime capabilities; there is no extra
  // workstream signature requirement, even when old planning metadata exists.
  expect((await tool("write_file",{path:path.join(root,"file.txt"),content:"safe"})).isError)
    .not.toBe(true);
  expect(invoked.length).toBe(before+1);
  // Signatures may remain for historical integrity, never as an execution gate.
  expect(store.attachMissionApproval(id,signed)).toMatchObject({approved:true});
  expect(missionApprovalStatus(store.get(id),path.join(dir,"human-approval-signer.json")).reason)
    .toBe("USER_CONFIRMED");

  // Scope/prohibitedChanges are planner notes, NOT additional OWL access
  // decisions. Runtime, and the actual OS, remain the enforcement authority.
  expect((await tool("write_file",{path:path.join(outside,"bad.txt"),content:"delegated to runtime"})).isError)
    .not.toBe(true);
  expect((await tool("write_file",{path:path.join(root,"escape","bad.txt"),content:"delegated to runtime"})).isError)
    .not.toBe(true);
  expect((await tool("execute_command",{cwd:root,command:"echo test",workspace_mode:"read"})).isError)
    .not.toBe(true);
  expect((await tool("start_process",{cwd:root,command:"echo test",workspace_mode:"read"})).isError)
    .not.toBe(true);
  expect((await tool("runtime_info",{})).isError).not.toBe(true);

  // Even an obsolete/tampered historical signature does not lock out an
  // already authorized current user from their Runtime capabilities.
  const state=store.read();
  state.owners[id].workstream.missionContract.allowedRepositories.push("other-project");
  store.write(state);
  expect(missionApprovalStatus(store.get(id),path.join(dir,"human-approval-signer.json")).reason)
    .toBe("MISSION_SCOPE_CHANGED");
  expect((await tool("write_file",{path:path.join(root,"a.txt"),content:"no mission gate"})).isError)
    .not.toBe(true);

  const resumed=new PlannerContinuationStore({file:store.file});
  expect(resumed.get(id).checkpoint.goal).toBe("Validate Vibe Monitor 1.0.1");
  expect(resumed.get(id).checkpoint.doNotRepeat).toContain("Never create Beta42");
 });
});
