#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpUrl = new URL(
  process.env.OWL_MCP_URL || "http://127.0.0.1:8790/mcp",
);
const repo = process.env.OWL_E2E_REPO || process.cwd();
const owner = process.env.OWL_E2E_OWNER || "owl-desktop:local-e2e";

function textResult(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function connect(label) {
  const client = new Client({
    name: `owl-local-e2e-${label}`,
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: {
      headers: { "x-owl-owner-id": owner },
    },
  });
  await client.connect(transport);
  return { client, transport };
}

const first = await connect("first");
try {
  const tools = await first.client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const required of [
    "runtime_info",
    "provider_status",
    "primitive_call",
    "skill_run",
    "git_status",
    "agent_requests_status",
    "agent_requests_list",
    "agent_requests_claim",
    "agent_requests_release",
    "agent_requests_complete",
  ]) {
    if (!names.has(required)) {
      throw new Error(`Missing MCP tool: ${required}`);
    }
  }

  const instructions = first.client.getInstructions();
  if (!instructions?.includes("AgentRequests")) {
    throw new Error("OWL MCP server instructions do not describe Agent Inbox.");
  }

  const info = await first.client.callTool({
    name: "runtime_info",
    arguments: {},
  });
  if (info.isError) throw new Error(textResult(info));

  const inbox = await first.client.callTool({
    name: "agent_requests_status",
    arguments: {},
  });
  if (inbox.isError) throw new Error(textResult(inbox));
  const inboxStatus = JSON.parse(textResult(inbox));
  if (inboxStatus.available !== true) {
    throw new Error("Agent Inbox is not available through OWL MCP.");
  }

  const status = await first.client.callTool({
    name: "git_status",
    arguments: { cwd: repo },
  });
  if (status.isError) throw new Error(textResult(status));

  const parsed = JSON.parse(textResult(status));
  const direct = execFileSync(
    "git",
    ["status", "--short", "--branch"],
    { cwd: repo, encoding: "utf8" },
  );
  if (parsed.stdout !== direct || parsed.exitCode !== 0) {
    throw new Error("MCP Git status does not match direct Git status.");
  }

  const retry = await first.client.callTool({
    name: "git_status",
    arguments: { cwd: repo },
  });
  if (textResult(retry) !== textResult(status)) {
    throw new Error("Read-only retry changed the Git status result.");
  }

  console.log("PASS tool discovery");
  console.log("PASS RuntimeClient info");
  console.log("PASS MCP Agent Inbox discovery");
  console.log("PASS MCP → Runtime git.query → local repository");
  console.log("PASS deterministic read-only retry");
} finally {
  await first.transport.close().catch(() => undefined);
}

const second = await connect("reconnect");
try {
  const info = await second.client.callTool({
    name: "runtime_info",
    arguments: {},
  });
  if (info.isError) throw new Error(textResult(info));
  console.log("PASS same logical owner reconnect");
} finally {
  await second.transport.close().catch(() => undefined);
}
