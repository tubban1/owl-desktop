import http from "node:http";
import {describe,it,expect} from "vitest";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {startOwlMcpHttpServer} from "../mcp/http-server.mjs";

async function withMcp(native,fn){
 const invoked=[];
 const runtime=http.createServer(async(req,res)=>{
  let body="";for await(const chunk of req)body+=chunk;
  const message=JSON.parse(body||"{}");invoked.push(message.method);
  res.setHeader("content-type","application/json");
  res.end(JSON.stringify({ok:true,apiVersion:"0.1",result:{apiVersion:"0.1",runtimeVersion:"test",access:{state:"READY"}}}));
 });
 await new Promise(resolve=>runtime.listen(0,"127.0.0.1",resolve));
 let mcp,transport;
 try{
  mcp=await startOwlMcpHttpServer({port:0,runtimeBaseUrl:"http://127.0.0.1:"+runtime.address().port,userChromeBridge:native});
  const client=new Client({name:"browser-parity-integration",version:"1"});
  transport=new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:{"x-owl-owner-id":"browser-test-owner"}}});
  await client.connect(transport);
  await fn(client,invoked);
 }finally{
  await transport?.close().catch(()=>{});
  await mcp?.close();
  await new Promise(resolve=>runtime.close(resolve));
 }
}
describe("MCP browser compatibility tool transport",()=>{
 it("routes generic browser_open to an existing Chrome Agent tab",async()=>{
  const calls=[];
  const bridge={
   status:()=>({connected:true}),
   open:async(owner,url)=>{calls.push({owner,url});return {pageId:42,background:true};},
   tabs:async()=>({tabs:[{pageId:42,url:"https://example.org",selected:true}]}),
   snapshot:async()=>({snapshot:{url:"https://example.org",controls:[]}})
  };
  await withMcp(bridge,async(client,invoked)=>{
   const opened=await client.callTool({name:"browser_open",arguments:{url:"https://example.org"}});
   expect(opened.isError).not.toBe(true);
   expect(JSON.parse(opened.content[0].text)).toMatchObject({pageId:42,browserMode:"existing-chrome",newBrowserProcess:false});
   const snapshot=await client.callTool({name:"browser_snapshot",arguments:{}});
   expect(JSON.parse(snapshot.content[0].text)).toHaveProperty("snapshot");
   expect(calls).toHaveLength(1);
   expect(invoked).not.toContain("primitive.call");
  });
 });
 it("fails closed when Native Chrome is disconnected, without isolated Chromium fallback",async()=>{
  await withMcp(null,async(client,invoked)=>{
   const output=await client.callTool({name:"browser_open",arguments:{url:"https://example.org"}});
   expect(output.isError).toBe(true);
   expect(output.content[0].text).toContain("CHROME_NATIVE_BRIDGE_UNAVAILABLE");
   expect(invoked).not.toContain("primitive.call");
  });
 });
});
