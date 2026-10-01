#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";

const runtimeBaseUrl =
  process.env.OWL_RUNTIME_URL || "http://127.0.0.1:18788";
const mcpUrl = new URL(
  process.env.OWL_MCP_URL || "http://127.0.0.1:8790/mcp",
);
const repo = process.env.OWL_E2E_REPO || process.cwd();
const suffix =
  process.env.OWL_E2E_SUFFIX ||
  Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
const owner = `owl-desktop:agent-request-e2e:${suffix}`;
const runtime = new RuntimeHttpClient({
  baseUrl: runtimeBaseUrl,
  sessionId: owner,
});

function manifest(id, requiredPrimitiveAbi) {
  return {
    schemaVersion: 1,
    skillAbiVersion: 1,
    id,
    version: "0.0.1",
    title: "AgentRequest E2E repository check",
    description:
      "Live E2E candidate used to prove Runtime AgentRequest production and Desktop MCP coordination.",
    requiredPrimitiveAbi,
    requiredPrimitives: ["git.query"],
    executionMode: "durable",
    inputs: {
      cwd: {
        type: "string",
        required: true,
        description: "Repository working directory",
      },
    },
    contract: {
      riskLevel: "low",
      idempotent: true,
      sideEffects: [],
      retryPolicy: "automatic",
      requiresVerification: false,
      resources: [],
    },
    steps: [
      {
        id: "status",
        primitive: "git.query",
        op: "status",
        args: { cwd: { $input: "cwd" } },
      },
    ],
    provenance: { origin: "workflow" },
  };
}

function textResult(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function connect() {
  const client = new Client({
    name: "owl-agent-request-live-e2e",
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

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name}: ${textResult(result)}`);
  }
  const text = textResult(result);
  return text ? JSON.parse(text) : null;
}

async function waitForRequest(client, subjectId, expectedStatuses, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await call(client, "agent_requests_list", {
      statuses: ["pending", "claimed", "completed", "cancelled"],
      limit: 100,
    });
    const match = rows.find(
      (request) =>
        request?.subject?.kind === "skill_candidate" &&
        request?.subject?.id === subjectId &&
        expectedStatuses.includes(request.status),
    );
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for AgentRequest subject=${subjectId} status=${expectedStatuses.join(",")}`,
  );
}

async function submitInvalid(id) {
  const submitted = await runtime.submitSkillCandidate(manifest(id, 99));
  const candidate = submitted.candidate;
  assert.ok(candidate?.id);
  const report = await runtime.validateSkillCandidate(
    candidate.id,
    candidate.currentDigest,
  );
  assert.equal(report.valid, false);
  assert.ok(
    report.errors.some(
      (error) => error.code === "USER_SKILL_PRIMITIVE_ABI_UNSUPPORTED",
    ),
  );
  return candidate;
}

const first = await connect();
const candidates = [];
try {
  const statusBefore = await call(first.client, "agent_requests_status");
  assert.equal(statusBefore.available, true);

  // Flow A: Runtime proposal -> Desktop Inbox -> MCP claim/release/complete.
  const idA = `user.e2e_agent_request_complete_${suffix}`;
  const candidateA = await submitInvalid(idA);
  candidates.push(candidateA);

  const pendingA = await waitForRequest(
    first.client,
    candidateA.id,
    ["pending"],
  );
  assert.equal(pendingA.type, "skill.repair");
  assert.equal(pendingA.priority, "high");
  assert.equal(pendingA.requiresUserConfirmation, true);
  assert.ok(
    pendingA.errorCodes.includes("USER_SKILL_PRIMITIVE_ABI_UNSUPPORTED"),
  );

  const claimedA = await call(first.client, "agent_requests_claim", {
    request_id: pendingA.requestId,
    lease_seconds: 60,
  });
  assert.equal(claimedA.status, "claimed");

  const releasedA = await call(first.client, "agent_requests_release", {
    request_id: pendingA.requestId,
  });
  assert.equal(releasedA.status, "pending");

  const reclaimedA = await call(first.client, "agent_requests_claim", {
    request_id: pendingA.requestId,
    lease_seconds: 60,
  });
  assert.equal(reclaimedA.status, "claimed");

  const completedA = await call(first.client, "agent_requests_complete", {
    request_id: pendingA.requestId,
    outcome: "e2e_verified",
    result_ref: `skill-candidate:${candidateA.id}`,
  });
  assert.equal(completedA.status, "completed");
  assert.equal(completedA.resolution?.outcome, "e2e_verified");

  // Dismiss emits a withdrawal. A completed coordination record must not be
  // rewritten as cancelled.
  await runtime.dismissSkillCandidate(candidateA.id, candidateA.currentDigest);
  const completedAfterWithdrawal = await waitForRequest(
    first.client,
    candidateA.id,
    ["completed"],
  );
  assert.equal(completedAfterWithdrawal.requestId, pendingA.requestId);

  // Flow B: pending proposal -> repaired candidate -> Runtime withdrawal ->
  // Desktop cancels only the still-pending request.
  const idB = `user.e2e_agent_request_withdraw_${suffix}`;
  const candidateB = await submitInvalid(idB);
  candidates.push(candidateB);
  const pendingB = await waitForRequest(
    first.client,
    candidateB.id,
    ["pending"],
  );

  const revised = await runtime.reviseSkillCandidate(
    candidateB.id,
    candidateB.currentDigest,
    manifest(idB, 1),
  );
  const repaired = revised.candidate;
  const repairedReport = await runtime.validateSkillCandidate(
    repaired.id,
    repaired.currentDigest,
  );
  assert.equal(repairedReport.valid, true);

  const cancelledB = await waitForRequest(
    first.client,
    candidateB.id,
    ["cancelled"],
  );
  assert.equal(cancelledB.requestId, pendingB.requestId);
  assert.match(
    cancelledB.resolution?.outcome ?? "",
    /^RUNTIME_WITHDRAWN:/,
  );

  await runtime.dismissSkillCandidate(repaired.id, repaired.currentDigest);

  const events = await runtime.listEvents({
    types: ["agent_request.proposed", "agent_request.withdrawn"],
    limit: 100,
  });
  const eventRows = Array.isArray(events?.events) ? events.events : [];
  assert.ok(
    eventRows.some(
      (event) =>
        event.eventType === "agent_request.proposed" &&
        event.subject?.id === candidateA.id,
    ),
  );
  assert.ok(
    eventRows.some(
      (event) =>
        event.eventType === "agent_request.withdrawn" &&
        event.subject?.id === candidateB.id,
    ),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtime: runtimeBaseUrl,
        mcp: mcpUrl.toString(),
        candidateComplete: candidateA.id,
        candidateWithdrawn: candidateB.id,
        proposalMaterialized: true,
        claimReleaseReclaimComplete: true,
        completedNotCancelledByWithdrawal: true,
        pendingCancelledByWithdrawal: true,
        durableRuntimeEventsObserved: true,
      },
      null,
      2,
    ),
  );
} finally {
  await first.transport.close().catch(() => undefined);
}
