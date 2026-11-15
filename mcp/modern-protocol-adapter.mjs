/**
 * Modern (2026-07-28) HTTP adaptation over the existing OWL operation registry.
 * The v2 SDK owns the wire protocol, errors, schema validation and discovery.
 * Runtime/Browser/Cloud authority remains with the same original handlers.
 * Never claim MCP Tasks; OWL's durable task APIs remain OWL-specific.
 */
import {McpServer,createMcpHandler,fromJsonSchema,originValidationResponse} from '@modelcontextprotocol/server';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {createOwlMcpServer} from './create-server.mjs';
const ERA='io.modelcontextprotocol/protocolVersion';
const LEGACY_VERSIONS=new Set(['2025-11-25','2025-06-18','2025-03-26','2024-11-05']);
export function isModernMcpRequest(req){
  const version=req.headers['mcp-protocol-version'];
  const bodyVersion=req.body?.params?._meta?.[ERA];
  return req.body?.method==='server/discover' ||
    (typeof version==='string'&&!LEGACY_VERSIONS.has(version)) ||
    (typeof bodyVersion==='string'&&!LEGACY_VERSIONS.has(bodyVersion));
}
export function createModernMcpAdapter(options={}){
  const old=createOwlMcpServer(options);
  // One source of truth: 151 old handlers, descriptions, permissions and schemas.
  // The SDK v1 registry is internal; pin the SDK and gate its shape in CI.
  const entries=Object.entries(old._registeredTools??{});
  if(entries.length===0)throw new Error('OWL_MODERN_TOOL_REGISTRY_EMPTY');
  const definitions=entries.map(([name,oldTool])=>{
    if(typeof oldTool.handler!=='function'||!oldTool.inputSchema)
      throw new Error('OWL_MODERN_TOOL_REGISTRY_INCOMPATIBLE:'+name);
    return {name,oldTool,config:{
      title:oldTool.title,description:oldTool.description,
      inputSchema:fromJsonSchema(zodToJsonSchema(oldTool.inputSchema)),
      ...(oldTool.outputSchema?{outputSchema:fromJsonSchema(zodToJsonSchema(oldTool.outputSchema))}:{}),
      annotations:oldTool.annotations,
    }};
  });
  const makeServer=()=>{
    const server=new McpServer({name:'owl-mcp',version:'0.1.0'});
    for(const {name,oldTool,config} of definitions){
      server.registerTool(name,config,async (args,extra)=>oldTool.handler(args,extra));
    }
    return server;
  };
  const handler=createMcpHandler(makeServer,{legacy:'stateless',responseMode:'json'});
  const allowOrigins=['localhost','127.0.0.1',
    ...(process.env.OWL_MCP_ALLOWED_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean)];
  return {
    toolCount:definitions.length,
    async handle(request){
      const rejected=originValidationResponse(request,allowOrigins);
      if(rejected)return rejected;
      return await handler.fetch(request);
    },
    async close(){await old.close();},
  };
}
