#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";
import { AgentInboxStore } from "../electron/services/agent-inbox-store.mjs";
import { RuntimeAgentRequestEventConsumer } from "../electron/services/runtime-agent-request-consumer.mjs";
import { RuntimeAgentRequestEventBridge } from "../electron/services/runtime-agent-request-event-bridge.mjs";

function assert(condition, message, details) {
  if (!condition) {
    const suffix =
      details === undefined ? "" : "\n" + JSON.stringify(details, null, 2);
    throw new Error(message + suffix);
  }
}

const baseUrl =
  process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:18788";
const token = process.env.OWL_RUNTIME_API_TOKEN?.trim() || undefined;
const fixtureRepo = process.env.OWL_RUNTIME_FIXTURE_REPO?.trim();

assert(
  fixtureRepo,
  "OWL_RUNTIME_FIXTURE_REPO is required for Runtime AgentRequest live E2E.",
);

const runtime = new RuntimeHttpClient({
  baseUrl,
  sessionId: "owl-desktop:runtime-agent-request-live-e2e",
  token,
});

const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "owl-desktop-runtime-event-live-"),
);

function manifest(name, requiredPrimitiveAbi) {
  return {
    schemaVersion: 1,
    skillAbiVersion: 1,
    id: `user.desktop_event_${name}`,
    version: "0.1.0",
    title: `Desktop Runtime Event ${name}`,
    description:
      "Cross-repository Desktop Runtime AgentRequest event bridge acceptance fixture.",
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

async function createSemanticIssue(name) {
  const submitted = await runtime.submitSkillCandidate(manifest(name, 999));
  const candidate = submitted?.candidate;
  assert(candidate?.id, "Candidate submission returned no id.", submitted);

  const validation = await runtime.validateSkillCandidate(
    candidate.id,
    candidate.currentDigest,
  );
  assert(validation?.valid === false, "Semantic fixture unexpectedly validated.", validation);
  assert(
    validation?.errors?.some(
      (issue) => issue?.code === "USER_SKILL_PRIMITIVE_ABI_UNSUPPORTED",
    ),
    "Expected semantic repair error was not produced.",
    validation,
  );

  return candidate;
}

async function resolveSemanticIssue(candidate, name) {
  const revised = await runtime.reviseSkillCandidate(
    candidate.id,
    candidate.currentDigest,
    manifest(name, 1),
  );
  assert(
    revised?.candidate?.revision === candidate.revision + 1,
    "Candidate revision did not advance.",
    revised,
  );
  return revised.candidate;
}

function makeDesktopState(prefix) {
  const dir = path.join(scratch, prefix);
  const inbox = new AgentInboxStore({
    file: path.join(dir, "agent-inbox.json"),
  });
  const consumerStateFile = path.join(
    dir,
    "runtime-agent-request-consumer.json",
  );
  const bridgeStateFile = path.join(
    dir,
    "runtime-agent-request-event-bridge.json",
  );
  const consumer = new RuntimeAgentRequestEventConsumer({
    inbox,
    stateFile: consumerStateFile,
  });

  const eventRequests = [];
  const eventClient = {
    capabilities: (...args) => runtime.capabilities(...args),
    listEvents: async (request) => {
      eventRequests.push(structuredClone(request ?? {}));
      return await runtime.listEvents(request);
    },
  };

  const bridge = new RuntimeAgentRequestEventBridge({
    client: eventClient,
    consumer,
    inbox,
    stateFile: bridgeStateFile,
    pollIntervalMs: 60_000,
  });

  return {
    dir,
    inbox,
    consumer,
    consumerStateFile,
    bridgeStateFile,
    eventClient,
    eventRequests,
    bridge,
  };
}

try {
  const info = await runtime.info();
  assert(info.apiVersion === "0.1", "Unexpected Runtime API.", info);

  const capabilities = await runtime.capabilities(
    "public runtime events agent request",
  );
  assert(
    Number(capabilities?.extensions?.publicEventJournal?.version ?? 0) >= 1,
    "Runtime does not expose publicEventJournal v1.",
    capabilities?.extensions,
  );
  assert(
    Number(capabilities?.extensions?.agentRequestProducer?.version ?? 0) >= 1,
    "Runtime does not expose agentRequestProducer v1.",
    capabilities?.extensions,
  );
  console.log("PASS Runtime public event extensions feature-detected");

  const desktop = makeDesktopState("primary");

  const firstCandidate = await createSemanticIssue("primary");
  const firstSync = await desktop.bridge.syncOnce();

  assert(firstSync.status === "healthy", "Initial Desktop event sync is not healthy.", firstSync);
  assert(
    firstSync.consumer.lastSequence === 1 &&
      firstSync.consumer.lastCursor === "runtime-events:1",
    "Desktop did not establish cursor 1 from the first Runtime event.",
    firstSync.consumer,
  );

  const pending = desktop.inbox.list({
    statuses: ["pending"],
    limit: 20,
  });
  assert(pending.length === 1, "Runtime proposal did not materialize exactly one AgentRequest.", pending);
  assert(pending[0].producer === "runtime", "AgentRequest producer is not Runtime.", pending[0]);
  assert(pending[0].type === "skill.repair", "AgentRequest type mismatch.", pending[0]);
  assert(
    pending[0].subject.id === firstCandidate.id &&
      pending[0].subject.revision === "1",
    "AgentRequest lost Candidate identity.",
    pending[0],
  );
  assert(
    pending[0].contextRefs.some(
      (ref) =>
        ref.kind === "skill_candidate" &&
        ref.id === firstCandidate.id &&
        ref.revision === "1",
    ),
    "AgentRequest did not preserve Runtime Candidate context reference.",
    pending[0],
  );
  console.log("PASS Runtime proposed event materialized into canonical Desktop Agent Inbox");

  const restartedConsumer = new RuntimeAgentRequestEventConsumer({
    inbox: desktop.inbox,
    stateFile: desktop.consumerStateFile,
  });
  const restartedRequests = [];
  const restartedClient = {
    capabilities: (...args) => runtime.capabilities(...args),
    listEvents: async (request) => {
      restartedRequests.push(structuredClone(request ?? {}));
      return await runtime.listEvents(request);
    },
  };
  const restartedBridge = new RuntimeAgentRequestEventBridge({
    client: restartedClient,
    consumer: restartedConsumer,
    inbox: desktop.inbox,
    stateFile: desktop.bridgeStateFile,
    pollIntervalMs: 60_000,
  });

  const replay = await restartedBridge.syncOnce();
  assert(replay.status === "healthy", "Restart replay was not healthy.", replay);
  assert(
    desktop.inbox.list({ statuses: ["pending"], limit: 20 }).length === 1,
    "Desktop restart/replay duplicated the AgentRequest.",
  );
  assert(
    restartedRequests[0]?.afterCursor === "runtime-events:1",
    "Restart did not resume from durable cursor 1.",
    restartedRequests,
  );
  console.log("PASS Desktop consumer restart resumes from durable cursor without duplication");

  await resolveSemanticIssue(firstCandidate, "primary");
  const withdrawn = await restartedBridge.syncOnce();

  assert(withdrawn.status === "healthy", "Withdrawal sync was not healthy.", withdrawn);
  assert(
    withdrawn.consumer.lastSequence === 2 &&
      withdrawn.consumer.lastCursor === "runtime-events:2",
    "Withdrawal did not advance to cursor 2.",
    withdrawn.consumer,
  );
  const cancelled = desktop.inbox.list({
    statuses: ["cancelled"],
    limit: 20,
  });
  assert(cancelled.length === 1, "Runtime withdrawal did not cancel the matching pending request.", cancelled);
  assert(
    cancelled[0].correlationId === pending[0].correlationId,
    "Withdrawal cancelled the wrong AgentRequest.",
    { pending: pending[0], cancelled: cancelled[0] },
  );
  console.log("PASS Runtime withdrawn event cancels only the matching pending AgentRequest");

  // Keep Desktop parked on cursor 2 while Runtime advances beyond a retention
  // window of two events. The CI Runtime is configured with
  // RUNTIME_PUBLIC_EVENT_RETENTION_MAX=2.
  const secondCandidate = await createSemanticIssue("retention_b");
  await resolveSemanticIssue(secondCandidate, "retention_b");
  await createSemanticIssue("retention_c");

  const beforeGap = restartedConsumer.readState();
  assert(
    beforeGap.lastCursor === "runtime-events:2",
    "Desktop cursor moved while event polling was intentionally paused.",
    beforeGap,
  );

  const callsBeforeGap = restartedRequests.length;
  const gap = await restartedBridge.syncOnce();
  assert(gap.status === "needs_attention", "Retention gap did not enter needs_attention.", gap);
  assert(
    gap.reconciliation?.reasonCode === "CURSOR_EXPIRED",
    "Retention gap reason was not CURSOR_EXPIRED.",
    gap.reconciliation,
  );
  assert(
    gap.reconciliation?.savedCursor === "runtime-events:2" &&
      gap.reconciliation?.savedSequence === 2,
    "Retention gap did not preserve the last known-good Desktop cursor.",
    gap.reconciliation,
  );
  assert(
    gap.reconciliation?.oldestRetainedSequence === 4,
    "Runtime retention floor was not surfaced to Desktop.",
    gap.reconciliation,
  );
  assert(
    restartedConsumer.readState().lastCursor === "runtime-events:2",
    "Desktop advanced the cursor across a retention gap.",
    restartedConsumer.readState(),
  );
  console.log("PASS CURSOR_EXPIRED enters durable reconciliation without cursor jump");

  await restartedBridge.syncOnce();
  assert(
    restartedRequests.length === callsBeforeGap + 1,
    "Normal polling continued after needs_attention.",
    restartedRequests,
  );
  assert(
    restartedConsumer.readState().lastCursor === "runtime-events:2",
    "Blocked normal polling changed the saved cursor.",
  );
  console.log("PASS normal polling is blocked while reconciliation is unresolved");

  const callsBeforeRetry = restartedRequests.length;
  const retry = await restartedBridge.retrySavedCursor();
  assert(retry.status === "needs_attention", "Explicit retry unexpectedly cleared retention gap.", retry);
  assert(
    restartedRequests.length === callsBeforeRetry + 1,
    "Explicit retry did not call Runtime exactly once.",
  );
  assert(
    restartedRequests.at(-1)?.afterCursor === "runtime-events:2",
    "Explicit retry did not use the saved durable cursor.",
    restartedRequests.at(-1),
  );
  assert(
    restartedConsumer.readState().lastCursor === "runtime-events:2",
    "Explicit retry jumped to Runtime newest cursor.",
    restartedConsumer.readState(),
  );
  console.log("PASS explicit retry reuses saved cursor and never jumps to newest");

  const freshDesktop = makeDesktopState("fresh-after-retention");
  const fresh = await freshDesktop.bridge.syncOnce();
  assert(
    fresh.status === "needs_attention",
    "Fresh Desktop silently began replay above journal genesis.",
    fresh,
  );
  assert(
    fresh.reconciliation?.reasonCode ===
      "RUNTIME_EVENT_HISTORY_TRUNCATED_BEFORE_FIRST_CHECKPOINT",
    "Fresh truncated replay did not enter explicit reconciliation.",
    fresh.reconciliation,
  );
  assert(
    fresh.consumer.lastCursor === null &&
      fresh.consumer.lastSequence === null,
    "Fresh Desktop established a cursor after truncated history.",
    fresh.consumer,
  );
  assert(
    freshDesktop.inbox.list({ statuses: ["pending"], limit: 20 }).length === 0,
    "Fresh Desktop materialized retained events despite missing earlier history.",
  );
  console.log("PASS fresh Desktop refuses truncated first replay and enters needs_attention");

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtimeVersion: info.runtimeVersion,
        apiVersion: info.apiVersion,
        acceptedCursorBeforeGap: "runtime-events:2",
        retentionOldestAfterGap: 4,
        reconciliation: "explicit_needs_attention",
        skipToLatest: false,
        retryUsesSavedCursor: true,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
