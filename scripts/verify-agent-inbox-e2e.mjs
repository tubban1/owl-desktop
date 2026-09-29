#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AgentInboxStore } from "../electron/services/agent-inbox-store.mjs";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

function textResult(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function connect(url, owner, label) {
  const client = new Client({
    name: `owl-agent-inbox-e2e-${label}`,
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: { "x-owl-owner-id": owner },
    },
  });
  await client.connect(transport);
  return { client, transport };
}

const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "owl-agent-inbox-e2e-"),
);
const inbox = new AgentInboxStore({
  file: path.join(scratch, "agent-inbox.json"),
});

const seeded = inbox.create({
  type: "skill.repair",
  producer: "desktop",
  priority: "high",
  subject: {
    kind: "skill_candidate",
    id: "candidate_e2e",
    revision: "2",
  },
  reasonCode: "VALIDATION_FAILED",
  errorCodes: ["PRIMITIVE_ABI_MISMATCH"],
  contextRefs: [
    { kind: "validation_report", id: "validation_e2e" },
  ],
  allowedActions: [
    "candidate.inspect",
    "candidate.revise",
    "candidate.validate",
  ],
  requiresUserConfirmation: true,
  dedupeKey: "candidate_e2e:revision_2:validation",
}).request;

const server = await startOwlMcpHttpServer({
  port: 0,
  runtimeBaseUrl:
    process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:8788",
  runtimeToken: process.env.OWL_RUNTIME_API_TOKEN?.trim() || undefined,
  agentInbox: inbox,
});

const owner = "agent-inbox-e2e-owner";

try {
  const first = await connect(server.url, owner, "first");
  try {
    const instructions = first.client.getInstructions();
    if (!instructions?.includes("AgentRequests")) {
      throw new Error("MCP Agent Inbox instructions missing.");
    }

    const status = await first.client.callTool({
      name: "agent_requests_status",
      arguments: {},
    });
    const statusValue = JSON.parse(textResult(status));
    if (
      status.isError ||
      statusValue.available !== true ||
      statusValue.pending !== 1
    ) {
      throw new Error("Agent Inbox status did not expose the pending request.");
    }

    const listed = await first.client.callTool({
      name: "agent_requests_list",
      arguments: { limit: 10 },
    });
    const requests = JSON.parse(textResult(listed));
    if (
      listed.isError ||
      requests.length !== 1 ||
      requests[0].requestId !== seeded.requestId
    ) {
      throw new Error("AgentRequest list did not return the seeded request.");
    }

    const claimed = await first.client.callTool({
      name: "agent_requests_claim",
      arguments: {
        request_id: seeded.requestId,
        lease_seconds: 600,
      },
    });
    const claimedValue = JSON.parse(textResult(claimed));
    if (
      claimed.isError ||
      claimedValue.status !== "claimed" ||
      claimedValue.claim?.ownerStable !== true
    ) {
      throw new Error("AgentRequest claim did not bind to stable MCP owner.");
    }

    console.log("PASS AgentRequest discovery");
    console.log("PASS AgentRequest stable-owner claim");
  } finally {
    await first.transport.close().catch(() => undefined);
  }

  const second = await connect(server.url, owner, "reconnect");
  try {
    const listed = await second.client.callTool({
      name: "agent_requests_list",
      arguments: {
        statuses: ["pending", "claimed"],
        limit: 10,
      },
    });
    const requests = JSON.parse(textResult(listed));
    if (
      listed.isError ||
      requests.length !== 1 ||
      requests[0].status !== "claimed"
    ) {
      throw new Error("Claim did not survive same logical owner reconnect.");
    }

    const completed = await second.client.callTool({
      name: "agent_requests_complete",
      arguments: {
        request_id: seeded.requestId,
        outcome: "repaired",
        result_ref: "candidate_e2e@revision_3",
      },
    });
    const completedValue = JSON.parse(textResult(completed));
    if (
      completed.isError ||
      completedValue.status !== "completed" ||
      completedValue.resolution?.resultRef !== "candidate_e2e@revision_3"
    ) {
      throw new Error("AgentRequest completion was not persisted.");
    }

    console.log("PASS AgentRequest same-owner reconnect");
    console.log("PASS AgentRequest completion");
  } finally {
    await second.transport.close().catch(() => undefined);
  }

  const finalRecord = inbox.get(seeded.requestId);
  if (finalRecord?.status !== "completed") {
    throw new Error("AgentRequest final durable state is not completed.");
  }
  console.log("PASS durable Agent Inbox state");
} finally {
  await server.close().catch(() => undefined);
  fs.rmSync(scratch, { recursive: true, force: true });
}
