#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";
import { AgentInboxStore } from "../electron/services/agent-inbox-store.mjs";
import { RuntimeAgentRequestEventConsumer } from "../electron/services/runtime-agent-request-consumer.mjs";
import { RuntimeAgentRequestEventBridge } from "../electron/services/runtime-agent-request-event-bridge.mjs";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";

function assert(condition, message, details) {
  if (!condition) {
    const suffix =
      details === undefined ? "" : "\n" + JSON.stringify(details, null, 2);
    throw new Error(message + suffix);
  }
}

function textResult(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function connect(url, owner) {
  const client = new Client({
    name: "owl-agent-skill-repair-live-e2e",
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

function manifest(requiredPrimitiveAbi) {
  return {
    schemaVersion: 1,
    skillAbiVersion: 1,
    id: "user.agent_repair_live",
    version: "0.1.0",
    title: "Agent Repair Live",
    description:
      "Live acceptance fixture for AgentRequest-driven Candidate repair.",
    requiredPrimitiveAbi,
    requiredPrimitives: ["git.query"],
    executionMode: "durable",
    inputs: {
      cwd: {
        type: "string",
        required: true,
        description: "Repository path",
      },
    },
    contract: {
      riskLevel: "low",
      idempotent: true,
      sideEffects: [],
      retryPolicy: "automatic",
      requiresVerification: false,
    },
    steps: [
      {
        id: "status",
        primitive: "git.query",
        op: "status",
        args: {
          cwd: { $input: "cwd" },
        },
      },
    ],
    provenance: {
      origin: "user",
    },
  };
}

const runtimeBaseUrl =
  process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:8788";
const runtime = new RuntimeHttpClient({
  baseUrl: runtimeBaseUrl,
  sessionId: "owl-desktop:agent-skill-repair-live",
  token: process.env.OWL_RUNTIME_API_TOKEN?.trim() || undefined,
});

const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "owl-agent-skill-repair-live-"),
);
const inbox = new AgentInboxStore({
  file: path.join(scratch, "agent-inbox.json"),
});
const consumer = new RuntimeAgentRequestEventConsumer({
  inbox,
  stateFile: path.join(
    scratch,
    "runtime-agent-request-consumer.json",
  ),
});
const bridge = new RuntimeAgentRequestEventBridge({
  client: runtime,
  consumer,
  inbox,
  stateFile: path.join(
    scratch,
    "runtime-agent-request-event-bridge.json",
  ),
  pollIntervalMs: 60_000,
});

let server;
let transport;
try {
  const info = await runtime.info();
  const capabilities = await runtime.capabilities(
    "AgentRequest Skill repair consequential replay",
  );
  assert(
    Number(
      capabilities?.extensions?.userSkillRegistry?.version ?? 0,
    ) >= 1,
    "Runtime User Skill Registry v1 unavailable.",
    capabilities?.extensions,
  );
  assert(
    Number(
      capabilities?.extensions?.publicEventJournal?.version ?? 0,
    ) >= 1,
    "Runtime publicEventJournal v1 unavailable.",
    capabilities?.extensions,
  );
  assert(
    Number(
      capabilities?.extensions?.agentRequestProducer?.version ?? 0,
    ) >= 1,
    "Runtime agentRequestProducer v1 unavailable.",
    capabilities?.extensions,
  );
  assert(
    Number(
      capabilities?.extensions?.consequentialRequestReplay?.version ?? 0,
    ) >= 1,
    "Runtime consequentialRequestReplay v1 unavailable.",
    capabilities?.extensions,
  );
  console.log(
    `PASS Runtime repair extensions (${info.runtimeVersion}, API ${info.apiVersion})`,
  );

  const submitted = await runtime.submitSkillCandidate(
    manifest(999),
  );
  const source = submitted?.candidate;
  assert(
    source?.id && source?.currentDigest && source?.revision === 1,
    "Runtime Candidate submit did not return revision 1 identity.",
    submitted,
  );

  const invalid = await runtime.validateSkillCandidate(
    source.id,
    source.currentDigest,
  );
  assert(
    invalid?.valid === false &&
      invalid.errors?.some(
        (issue) =>
          issue?.code ===
          "USER_SKILL_PRIMITIVE_ABI_UNSUPPORTED",
      ),
    "Source Candidate did not produce semantic ABI repair issue.",
    invalid,
  );

  const firstSync = await bridge.syncOnce();
  assert(
    firstSync.status === "healthy" &&
      firstSync.consumer.lastSequence === 1,
    "Desktop did not consume the Runtime repair proposal.",
    firstSync,
  );

  const [request] = inbox.list({
    statuses: ["pending"],
    limit: 10,
  });
  assert(
    request?.type === "skill.repair" &&
      request?.producer === "runtime" &&
      request?.subject?.id === source.id &&
      request?.subject?.revision === "1",
    "Runtime proposal did not materialize the expected repair request.",
    request,
  );
  console.log("PASS Runtime repair proposal -> Desktop Agent Inbox");

  server = await startOwlMcpHttpServer({
    port: 0,
    runtimeBaseUrl,
    runtimeToken:
      process.env.OWL_RUNTIME_API_TOKEN?.trim() || undefined,
    agentInbox: inbox,
  });

  const owner = "agent-skill-repair-live-owner";
  const connection = await connect(server.url, owner);
  transport = connection.transport;
  const client = connection.client;

  const tools = await client.listTools();
  const toolNames = new Set(
    (tools.tools ?? []).map((tool) => tool.name),
  );
  assert(
    toolNames.has("skill_repair_context") &&
      toolNames.has("skill_repair_apply"),
    "OWL MCP did not expose Skill repair tools.",
    [...toolNames],
  );

  const claimed = await client.callTool({
    name: "agent_requests_claim",
    arguments: {
      request_id: request.requestId,
      lease_seconds: 600,
    },
  });
  const claimedValue = JSON.parse(textResult(claimed));
  assert(
    !claimed.isError &&
      claimedValue.status === "claimed" &&
      claimedValue.claim?.ownerStable === true,
    "Repair request did not bind to stable MCP owner.",
    claimedValue,
  );
  console.log("PASS stable MCP owner claimed Runtime repair request");

  const contextResult = await client.callTool({
    name: "skill_repair_context",
    arguments: { request_id: request.requestId },
  });
  const repairContext = JSON.parse(textResult(contextResult));
  assert(
    !contextResult.isError &&
      repairContext?.candidate?.id === source.id &&
      repairContext?.candidate?.revision === 1 &&
      repairContext?.candidate?.currentDigest ===
        source.currentDigest,
    "Skill repair context did not preserve canonical Candidate identity.",
    repairContext,
  );
  const contextJson = JSON.stringify(repairContext);
  assert(
    !contextJson.includes("publicEventOutbox") &&
      !contextJson.includes('"revisions"'),
    "Skill repair context leaked Runtime Candidate internals.",
    repairContext,
  );
  assert(
    repairContext?.privacy?.rawManifestExposed === false,
    "Skill repair context did not report privacy projection.",
    repairContext?.privacy,
  );
  console.log("PASS privacy-safe repair context");

  const repairedManifest = manifest(1);
  const applyArgs = {
    request_id: request.requestId,
    expected_digest: source.currentDigest,
    manifest: repairedManifest,
  };

  const applied = await client.callTool({
    name: "skill_repair_apply",
    arguments: applyArgs,
  });
  const appliedValue = JSON.parse(textResult(applied));
  assert(
    !applied.isError &&
      appliedValue?.applied === true &&
      appliedValue?.replayProtected === true &&
      appliedValue?.sourceRevision === 1 &&
      appliedValue?.revisedRevision === 2 &&
      appliedValue?.validation?.valid === true,
    "Replay-protected Candidate repair did not produce valid revision 2.",
    appliedValue,
  );
  console.log("PASS MCP repair revised and revalidated Candidate");

  const replay = await client.callTool({
    name: "skill_repair_apply",
    arguments: applyArgs,
  });
  const replayValue = JSON.parse(textResult(replay));
  assert(
    !replay.isError &&
      replayValue?.revisedRevision === 2 &&
      replayValue?.currentDigest === appliedValue.currentDigest,
    "Repair retry did not replay canonical revision 2.",
    replayValue,
  );

  const canonical = await runtime.getSkillCandidate(source.id);
  assert(
    canonical?.revision === 2 &&
      canonical?.currentDigest === appliedValue.currentDigest &&
      canonical?.validation?.valid === true,
    "Runtime replay created a duplicate revision or lost validation.",
    canonical,
  );
  assert(
    Array.isArray(canonical?.revisions) &&
      canonical.revisions.length === 2,
    "Repair retry created an unexpected third Candidate revision.",
    canonical?.revisions,
  );
  console.log("PASS same logical repair replay -> one Candidate revision");

  const withdrawalSync = await bridge.syncOnce();
  assert(
    withdrawalSync.status === "healthy" &&
      withdrawalSync.consumer.lastSequence === 2,
    "Desktop did not consume Runtime withdrawal after repair.",
    withdrawalSync,
  );

  const afterWithdrawal = inbox.get(request.requestId);
  assert(
    afterWithdrawal?.status === "claimed",
    "Runtime withdrawal silently cancelled active claimed repair work.",
    afterWithdrawal,
  );
  console.log("PASS claimed repair survives background withdrawal");

  const completed = await client.callTool({
    name: "agent_requests_complete",
    arguments: {
      request_id: request.requestId,
      outcome: "repaired_and_revalidated",
      result_ref: `${source.id}@2`,
    },
  });
  const completedValue = JSON.parse(textResult(completed));
  assert(
    !completed.isError &&
      completedValue?.status === "completed" &&
      completedValue?.resolution?.outcome ===
        "repaired_and_revalidated",
    "AgentRequest completion did not persist after Runtime validation.",
    completedValue,
  );

  assert(
    inbox.get(request.requestId)?.status === "completed",
    "Final AgentRequest state is not durably completed.",
  );
  assert(
    inbox.list({ statuses: ["pending"], limit: 20 }).length === 0,
    "Valid repaired revision unexpectedly produced another pending repair request.",
  );
  console.log("PASS repaired Runtime issue -> durable AgentRequest completion");

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtimeVersion: info.runtimeVersion,
        apiVersion: info.apiVersion,
        sourceRevision: 1,
        finalRevision: canonical.revision,
        replayCreatedExtraRevision: false,
        rawCandidateInternalsExposed: false,
        promotionAttempted: false,
      },
      null,
      2,
    ),
  );
} finally {
  if (transport) {
    await transport.close().catch(() => undefined);
  }
  if (server) {
    await server.close().catch(() => undefined);
  }
  bridge.stop();
  fs.rmSync(scratch, { recursive: true, force: true });
}
