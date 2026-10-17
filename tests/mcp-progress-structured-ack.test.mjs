import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers=[];
afterEach(async()=>{while(closers.length) await closers.pop()?.();});
function data(result){
 return JSON.parse(result.content.filter(x=>x.type==="text").map(x=>x.text).join("\n"));
}
describe("Structured progress acknowledgment",()=>{
 it("allows Chinese display attestation, blocks ID-only/cross-owner, keeps legacy and idempotent retries",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"owl-progress-v3-"));
  closers.push(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const continuation=new PlannerContinuationStore({file:path.join(dir,"planner.json")});
  const a=continuation.openWorkstream({goal:"Long task A"}).ownerId;
  const b=continuation.openWorkstream({goal:"Unrelated B"}).ownerId;
  const mock=http.createServer(async(req,res)=>{
    for await(const _ of req){}
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({ok:true,apiVersion:"0.1",result:{}}));
  });
  await new Promise((resolve,reject)=>{
    mock.once("error",reject);mock.listen(0,"127.0.0.1",resolve);
  });
  closers.push(()=>new Promise(resolve=>mock.close(resolve)));
  const mcp=await startOwlMcpHttpServer({
    port:0,runtimeBaseUrl:"http://127.0.0.1:"+mock.address().port,
    plannerContinuation:continuation,fallbackOwnerId:"progress-test-owner"
  });
  closers.push(()=>mcp.close());
  const transport=new StreamableHTTPClientTransport(new URL(mcp.url));
  closers.push(()=>transport.close().catch(()=>undefined));
  const client=new Client({name:"localized-progress-client",version:"0.1.0"});
  await client.connect(transport);
  const input={toolStepsSinceProgress:12,silenceMs:65000,retryTool:"task_cancel",
    current:"Before safe retry",completed:["Fetched state"],nextActions:["Continue task"],
    userVisibleProgress:"Finished fetching state. Now: paused. Next: resume task."};
  const aid=continuation.markProgressBoundary(a,input).workstream.progressBoundary.boundaryId;
  const bid=continuation.markProgressBoundary(b,input).workstream.progressBoundary.boundaryId;
  const progress=(workstream_id,args)=>client.callTool({
    name:"workstream_progress",arguments:{workstream_id,current:"验证阶段",...args}
  });
  const blocked=data(await client.callTool({
    name:"task_cancel",arguments:{workstream_id:a,task_id:"test-only"}
  }));
  expect(blocked.code).toBe("PROGRESS_UPDATE_REQUIRED");
  expect(blocked.progressBoundary.boundaryId).toBe(aid);
  expect(blocked.progressBoundary.acknowledgementProtocol).toBe("boundary_id_plus_visible_attestation");
  for(const args of [
    {progress_boundary_id:aid},
    {progress_boundary_id:aid,visible_progress_reported:false,
      user_visible_progress:"我向用户报告的进展不是原英文"}
  ]){
    expect(data(await progress(a,args)).code).toBe("PROGRESS_VISIBLE_UPDATE_REQUIRED");
    expect(continuation.get(a).workstream.progressBoundary.pending).toBe(true);
  }
  expect(data(await progress(b,{progress_boundary_id:aid,visible_progress_reported:true})).code)
    .toBe("PROGRESS_ACK_REQUIRED");
  expect(data(await progress(a,{progress_boundary_id:bid,visible_progress_reported:true})).code)
    .toBe("PROGRESS_ACK_REQUIRED");
  const acknowledged=data(await progress(a,{
    progress_boundary_id:aid,visible_progress_reported:true,
    user_visible_progress:"已完成检测，现在准备继续测试。"
  }));
  expect(acknowledged.acknowledgementMode).toBe("structured");
  expect(acknowledged.acknowledgedBoundaryId).toBe(aid);
  expect(acknowledged.userVisibleProgress).toBe(input.userVisibleProgress);
  expect(continuation.get(a).workstream.progressBoundary).toBeNull();
  expect(continuation.get(b).workstream.progressBoundary.pending).toBe(true);
  const revision=continuation.get(a).checkpoint.revision;
  const events=continuation.get(a).workstream.progressEvents.length;
  const dup=data(await progress(a,{progress_boundary_id:aid,visible_progress_reported:true}));
  expect(dup.acknowledgementMode).toBe("structured");
  expect(continuation.get(a).checkpoint.revision).toBe(revision);
  expect(continuation.get(a).workstream.progressEvents).toHaveLength(events);
  expect(data(await progress(a,{progress_boundary_id:bid,visible_progress_reported:true})).code)
    .toBe("PROGRESS_ACK_STALE");
  const legacy=data(await progress(b,{
    progress_boundary_id:bid,user_visible_progress:input.userVisibleProgress
  }));
  expect(legacy.acknowledgementMode).toBe("legacy_text");
  expect(continuation.get(b).workstream.progressBoundary).toBeNull();
 });
});
