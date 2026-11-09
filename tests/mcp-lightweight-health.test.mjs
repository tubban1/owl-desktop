import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

const closers = [];
afterEach(async () => { while (closers.length) await closers.pop()(); });

async function runtime(responseForMethod = () => ({ apiVersion: "0.1", runtimeVersion: "test" })) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true, apiVersion: "0.1", requestId: data.id,
      result: responseForMethod(data.method),
    }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

describe("MCP lightweight health and bounded latency diagnostics", () => {
  it("does not serialize checkpoint history on readiness probes", async () => {
    const hugePrivateHistory = { owners: Array.from({ length: 50 }, (_, i) => ({
      ownerId: `historic-${i}`, checkpoint: { summary: "history".repeat(600) },
    })) };
    let heavyReads = 0;
    let lightReads = 0;
    const plannerContinuation = {
      recoverConnectedTransports: () => {},
      healthSummary: () => { lightReads += 1; return { ownerCount: 50, connectedOwnerCount: 0, activeCheckpointCount: 34 }; },
      summary: () => { heavyReads += 1; return hugePrivateHistory; },
    };
    const server = await startOwlMcpHttpServer({
      port: 0, runtimeBaseUrl: await runtime(), plannerContinuation,
    });
    closers.push(() => server.close());
    const base = new URL(server.url).origin;

    for (let i = 0; i < 4; i += 1) {
      const response = await fetch(`${base}/health`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body.length).toBeLessThan(1500);
      expect(body).not.toContain("historic-");
      expect(JSON.parse(body).plannerContinuation.activeCheckpointCount).toBe(34);
    }
    expect(heavyReads).toBe(0);
    expect(lightReads).toBe(4);

    const diagnostic = await (await fetch(`${base}/diagnostics`)).json();
    expect(diagnostic.plannerContinuation.owners).toHaveLength(50);
    expect(heavyReads).toBe(1);
    expect(diagnostic.mcpLatency.sampleCount).toBe(0);
  });

  it("blocks OTA activation when Runtime/MCP work is present or telemetry fails", async () => {
    let active=false;
    const server=await startOwlMcpHttpServer({
      port:0, mcpToken:"ota-test-secret",
      otaActivityToken:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runtimeBaseUrl:await runtime(method => {
        if(method==="tasks.list")return active?[{status:"running"}]:[];
        if(method==="approvals.list")return [];
        if(method==="process")return [{status:"exited"}];
        return {apiVersion:"0.1",runtimeVersion:"test"};
      }),
    });
    closers.push(()=>server.close());
    const base=new URL(server.url).origin;
    expect((await fetch(base+"/ota/activity")).status).toBe(401);
    const headers={"x-owl-ota-activity-token":
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"};
    const idle=await (await fetch(base+"/ota/activity",{headers})).json();
    expect(idle).toMatchObject({ok:true,service:"owl-ota-activity",ready:true});
    expect(idle).not.toHaveProperty("tasks");
    active=true;
    const busy=await (await fetch(base+"/ota/activity",{headers})).json();
    expect(busy).toMatchObject({ready:false,reason:"runtime-or-mcp-work-active",activeTasks:1});
  });

  it("locally fences new MCP tools, fails closed for busy Runtime and releases safely", async () => {
    let active=false;
    const token="a".repeat(43);
    const server=await startOwlMcpHttpServer({
      port:0,mcpToken:"ota-test-secret",otaActivityToken:token,
      runtimeBaseUrl:await runtime(method=>{
        if(method==="tasks.list")return active?[{status:"running"}]:[];
        if(method==="approvals.list")return [];
        if(method==="process")return [{status:"exited"}];
        return {apiVersion:"0.1",runtimeVersion:"test"};
      }),
    });
    closers.push(()=>server.close());
    const base=new URL(server.url).origin;
    const headers={"content-type":"application/json","x-owl-ota-activity-token":token};
    const post=async(data,authorized=true)=>fetch(base+"/ota/drain",{
      method:"POST",headers:authorized?headers:{"content-type":"application/json"},
      body:JSON.stringify(data),
    });
    expect((await post({action:"arm"},false)).status).toBe(401);
    active=true;
    const rejected=await post({action:"arm",ttlMs:30000});
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).reason).toBe("runtime-or-mcp-work-active");
    active=false;
    const accepted=await post({action:"arm",ttlMs:30000});
    expect(accepted.status).toBe(200);
    const receipt=await accepted.json();
    expect(receipt).toMatchObject({ready:true});
    expect(typeof receipt.nonce).toBe("string");
    const tool=()=>fetch(server.url,{
      method:"POST",headers:{authorization:"Bearer ota-test-secret",
        "content-type":"application/json",
        accept:"application/json, text/event-stream"},
      body:JSON.stringify({jsonrpc:"2.0",id:4,method:"tools/call",
        params:{name:"task_status",arguments:{}}}),
    });
    const blocked=await tool();
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("retry-after")).toBe("5");
    expect(await blocked.json()).toMatchObject({error:"OTA_DRAINING",retryable:true});
    expect((await post({action:"release",nonce:"wrong"})).status).toBe(409);
    expect((await tool()).status).toBe(503);
    expect((await post({action:"release",nonce:receipt.nonce})).status).toBe(200);
    expect((await tool()).status).not.toBe(503);
  });

  it("records bounded, payload-free MCP request timing", async () => {
    const server = await startOwlMcpHttpServer({
      port: 0, runtimeBaseUrl: await runtime(),
    });
    closers.push(() => server.close());
    const base = new URL(server.url).origin;
    const response = await fetch(server.url, { method: "POST", headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    }, body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {},
        clientInfo: { name: "health-regression", version: "1.0.0" } },
    }) });
    expect(response.ok).toBe(true);
    await response.text();
    const health = await (await fetch(`${base}/health`)).json();
    expect(health.mcpLatency.sampleCount).toBe(1);
    expect(health.mcpLatency.p50Ms).toBeGreaterThanOrEqual(0);
    const diagnostics = await (await fetch(`${base}/diagnostics`)).json();
    expect(diagnostics.recentMcpCalls[0]).toMatchObject({ method: "initialize", status: 200 });
    expect(diagnostics.recentMcpCalls[0]).not.toHaveProperty("params");
    expect(diagnostics.recentMcpCalls[0]).not.toHaveProperty("requestBody");
  });
});
