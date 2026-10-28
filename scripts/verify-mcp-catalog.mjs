#!/usr/bin/env node
// Compare exact MCP tools/list JSON Schemas to a reviewed cross-platform lock.
// This starts only an isolated ephemeral MCP server, not the user's live Desktop.
import fs from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {startOwlMcpHttpServer} from "../mcp/http-server.mjs";
import {toolRegistrySnapshot} from "../mcp/tool-registry.mjs";
import {createOwlMcpServer} from "../mcp/create-server.mjs";
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lock=JSON.parse(fs.readFileSync(path.join(root,"mcp/tool-catalog.lock.json"),"utf8"));
const host=await startOwlMcpHttpServer({port:0,runtimeBaseUrl:"http://127.0.0.1:65530"});
let client,transport;
try{
 client=new Client({name:"owl-catalog-ci",version:"1.0"});
 transport=new StreamableHTTPClientTransport(new URL(host.url));
 await client.connect(transport);
 const tools=[];let cursor;
 do{const page=await client.listTools(cursor?{cursor}:{});tools.push(...page.tools);cursor=page.nextCursor;}while(cursor);
 const hash=createHash("sha256").update(JSON.stringify(tools)).digest("hex");
 const registry=toolRegistrySnapshot(createOwlMcpServer());
 const ids=tools.map(t=>t.name);
 const out={count:tools.length,fullSchemaSha256:hash,registrySha256:registry.namesSha256,source:"actual-sdk-tools-list"};
 if(tools.length!==new Set(ids).size)throw Error("Duplicate MCP IDs");
 if(registry.count!==tools.length)throw Error("Tool Registry count drift");
 if(lock.count!==out.count||lock.fullSchemaSha256!==hash||lock.registrySha256!==out.registrySha256)
  throw Error("MCP_TOOL_CATALOG_DRIFT "+JSON.stringify({expected:lock,actual:out}));
 console.log(JSON.stringify({ok:true,...out}));
}finally{await transport?.close().catch(()=>{});await host.close();}
