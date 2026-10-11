import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, expect, it, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
import { readAuthorizedLocalImage } from "../mcp/native-image.mjs";

const cleanups=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()?.()});
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S6sAAAAASUVORK5CYII=","base64");
async function files(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-native-image-"));
  cleanups.push(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,"one.png");await fs.writeFile(file,png);
  return {file,dir};
}
async function authorize(p){
  const st=await fs.stat(p);
  return {path:await fs.realpath(p),type:st.isFile()?"file":"other",size:st.size,modifiedAt:st.mtime.toISOString()};
}
describe("MCP native image transport",()=>{
  it("authenticates before read, checks MIME and exact file content",async()=>{
    const {file}=await files();
    let calls=0;
    const image=await readAuthorizedLocalImage(file,async p=>{calls++;return authorize(p)});
    expect(calls).toBe(1);
    expect(image.mimeType).toBe("image/png");
    expect(Buffer.from(image.data,"base64")).toEqual(png);
    expect(image.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("fails closed on disallowed, oversized, spoofed and changed paths",async()=>{
    const {file,dir}=await files();
    await expect(readAuthorizedLocalImage("/private/forbidden.png",async()=>{throw Error("Access denied")})).rejects.toThrow("Access denied");
    await expect(readAuthorizedLocalImage(file,authorize,12)).rejects.toMatchObject({code:"IMAGE_TOO_LARGE"});
    await expect(readAuthorizedLocalImage(file,async p=>({...await authorize(p),path:"/wrong"}))).rejects.toMatchObject({code:"IMAGE_PATH_CHANGED"});
    const invalid=path.join(dir,"spoof.png");await fs.writeFile(invalid,"NOT_IMAGE");
    await expect(readAuthorizedLocalImage(invalid,authorize)).rejects.toMatchObject({code:"IMAGE_FORMAT_UNSUPPORTED"});
    const alias=path.join(dir,"alias.png");await fs.symlink(file,alias);
    expect((await readAuthorizedLocalImage(alias,authorize)).mimeType).toBe("image/png");
  });
  it("emits actual ImageContent via Streamable HTTP without binary telemetry",async()=>{
    const {file}=await files();const events=[];
    const runtime=http.createServer(async(req,res)=>{
      let body="";for await(const c of req)body+=c;
      const q=JSON.parse(body);
      res.setHeader("content-type","application/json");
      res.end(JSON.stringify({ok:true,apiVersion:"0.1",result:q.method==="primitive.call"&&q.params?.primitive==="fs.stat"?{result:await authorize(q.params.args.path)}:{}}));
    });
    await new Promise((resolve,reject)=>{runtime.once("error",reject);runtime.listen(0,"127.0.0.1",resolve)});
    cleanups.push(()=>new Promise(resolve=>runtime.close(resolve)));
    const mcp=await startOwlMcpHttpServer({port:0,runtimeBaseUrl:"http://127.0.0.1:"+runtime.address().port,onEvent:(level,message,meta)=>events.push({level,message,meta})});
    cleanups.push(()=>mcp.close());
    const client=new Client({name:"test",version:"1"});
    const transport=new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:{"x-owl-owner-id":"test-image-owner"}}});
    await client.connect(transport);cleanups.push(()=>transport.close().catch(()=>undefined));
    const tool=(await client.listTools()).tools.find(x=>x.name==="read_image");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    const result=await client.callTool({name:"read_image",arguments:{path:file}});
    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("text");
    expect(result.content[1]).toMatchObject({type:"image",mimeType:"image/png",data:png.toString("base64")});
    // Old plugin sessions already expose read_multiple_files.
    const legacy=await client.callTool({name:"read_multiple_files",arguments:{paths:[file]}});
    expect(legacy.isError).not.toBe(true);
    expect(legacy.content.find(x=>x.type==="image")).toMatchObject({
      type:"image",mimeType:"image/png",data:png.toString("base64"),
    });
    expect(legacy.content.find(x=>x.type==="text")?.text).toContain("one.png");
    const fallback=await client.callTool({
      name:"report_external_tool_fallback",
      arguments:{external_tool:"desktop_commander",reason_code:"MISSING_TOOL_SCHEMA",owl_tool:"read_image"},
    });
    expect(fallback.isError).not.toBe(true);
    expect(events.some(x=>x.meta?.eventKind==="external_tool_fallback" &&
      x.meta?.reasonCode==="MISSING_TOOL_SCHEMA")).toBe(true);
    const telemetry=JSON.stringify(events);
    expect(telemetry).toContain("read_multiple_files");
    expect(telemetry).toContain("read_image");
    expect(telemetry).not.toContain(png.toString("base64"));
    expect(telemetry).toContain("image/png");
  });
});
