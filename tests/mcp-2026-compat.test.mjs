import http from 'node:http';
import {afterEach,describe,it,expect} from 'vitest';
import {Client as OldClient} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport as OldHttp} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Client as NewClient, StreamableHTTPClientTransport as NewHttp} from '@modelcontextprotocol/client';
import {startOwlMcpHttpServer} from '../mcp/http-server.mjs';
const clean=[];
afterEach(async()=>{while(clean.length)await clean.pop()?.();});
async function setup(){
  const runtime=http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    const body=JSON.parse(raw||'{}');
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({ok:true,apiVersion:'0.1',result:{runtimeVersion:'synthetic-readonly',apiVersion:'0.1',taskState:'read-only',method:body.method}}));
  });
  await new Promise(resolve=>runtime.listen(0,'127.0.0.1',resolve));
  clean.push(()=>new Promise(resolve=>runtime.close(resolve)));
  const mcp=await startOwlMcpHttpServer({port:0,runtimeBaseUrl:`http://127.0.0.1:${runtime.address().port}`});
  clean.push(()=>mcp.close());
  return mcp.url;
}
const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28',
  'io.modelcontextprotocol/clientCapabilities':{},
  'io.modelcontextprotocol/clientInfo':{name:'owl-2026-conformance',version:'1'}};
async function wire(url,method,params={},headers={},version='2026-07-28'){
  const hdr={'content-type':'application/json',accept:'application/json, text/event-stream',
   'MCP-Protocol-Version':version,'Mcp-Method':method,
   ...(method==='tools/call'?{'Mcp-Name':params.name}:{}),...headers};
  const r=await fetch(url,{method:'POST',headers:hdr,
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:{...meta,'io.modelcontextprotocol/protocolVersion':version}}})});
  const raw=await r.text();
  const response=r.headers.get('content-type')?.includes('text/event-stream')
   ?JSON.parse(raw.split(/\r?\n/).find(s=>s.startsWith('data: '))?.slice(6)??'{}'):JSON.parse(raw);
  return {status:r.status,response};
}
describe('OWL MCP dual era (isolated fake Runtime, no actual side effects)',()=>{
 it('2026 wire discovery and 151 tool definitions, result/cache fields',async()=>{
   const url=await setup();
   const discovery=await wire(url,'server/discover');
   expect(discovery.status).toBe(200);
   expect(discovery.response.result.supportedVersions).toContain('2026-07-28');
   expect(discovery.response.result.resultType).toBe('complete');
   const list=await wire(url,'tools/list');
   expect(list.status).toBe(200);
   expect(list.response.result.tools).toHaveLength(151);
   expect(list.response.result.tools.every(t=>t.inputSchema)).toBe(true);
   expect(list.response.result.resultType).toBe('complete');
   expect(typeof list.response.result.ttlMs).toBe('number');
   expect(list.response.result.cacheScope).toMatch(/^(private|public)$/);
   const again=await wire(url,'tools/list');
   expect(again.response.result.tools.map(t=>t.name)).toEqual(list.response.result.tools.map(t=>t.name));
 });
 it('real official v2 client modern pinned connects, calls runtime_info read-only',async()=>{
   const url=await setup();
   const client=new NewClient({name:'owl-test-modern',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
   const transport=new NewHttp(new URL(url));
   try{
     await client.connect(transport);
     expect(client.getProtocolEra()).toBe('modern');
     expect((await client.listTools()).tools).toHaveLength(151);
     const result=await client.callTool({name:'runtime_info',arguments:{}});
     expect(result.isError).not.toBe(true);
     expect(result.content[0].text).toContain('synthetic-readonly');
   }finally{await client.close();}
 });
 it('real existing SDK v1 session and tools continue to work',async()=>{
   const url=await setup();const client=new OldClient({name:'owl-test-legacy',version:'1'});
   const transport=new OldHttp(new URL(url));
   try{
     await client.connect(transport);
     expect(transport.sessionId).toBeTruthy();
     expect((await client.listTools()).tools).toHaveLength(151);
     expect((await client.callTool({name:'runtime_info',arguments:{}})).isError).not.toBe(true);
   }finally{await transport.close();}
 });
 it('legacy and 2026 preserve property names and required arguments across all tools',async()=>{
   const url=await setup();
   const modern=new NewClient({name:'owl-contract-parity-modern',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
   const old=new OldClient({name:'owl-contract-parity-legacy',version:'1'});
   const mt=new NewHttp(new URL(url));const lt=new OldHttp(new URL(url));
   try{
     await modern.connect(mt);await old.connect(lt);
     const m=(await modern.listTools()).tools;const o=(await old.listTools()).tools;
     expect(m).toHaveLength(151);expect(o).toHaveLength(151);
     const byOld=new Map(o.map(x=>[x.name,x]));
     for(const next of m){
       const prev=byOld.get(next.name);expect(prev,next.name).toBeTruthy();
       expect(Object.keys(next.inputSchema?.properties||{}).sort(),next.name).toEqual(Object.keys(prev.inputSchema?.properties||{}).sort());
       expect((next.inputSchema?.required||[]).slice().sort(),next.name).toEqual((prev.inputSchema?.required||[]).slice().sort());
       expect(next.annotations,next.name).toEqual(prev.annotations);
     }
   }finally{await modern.close();await lt.close();}
 });
 it('rejects malformed origin, wrong MCP method/tool headers and unsupported version',async()=>{
   const url=await setup();
   const origin=await wire(url,'server/discover',{}, {Origin:'https://evil.example'});
   expect(origin.status).toBe(403);
   const header=await wire(url,'tools/call',{name:'runtime_info',arguments:{}},{'Mcp-Name':'wrong-tool'});
   expect(header.status).toBe(400);
   expect(header.response.error.code).toBe(-32020);
   const version=await wire(url,'server/discover',{}, {},'1900-01-01');
   expect(version.response.error.code).toBe(-32022);
 });
});
