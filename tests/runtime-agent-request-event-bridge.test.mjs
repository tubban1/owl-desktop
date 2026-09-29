import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentInboxStore } from "../electron/services/agent-inbox-store.mjs";
import { RuntimeAgentRequestEventConsumer } from "../electron/services/runtime-agent-request-consumer.mjs";
import { RuntimeAgentRequestEventBridge } from "../electron/services/runtime-agent-request-event-bridge.mjs";

const scratch = [];

function makeScratch() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "owl-runtime-event-bridge-"),
  );
  scratch.push(dir);
  return dir;
}

function proposal(sequence = 100) {
  return {
    eventType: "agent_request.proposed",
    eventId: `evt_agent_${sequence}`,
    proposalId: `proposal_skill_${sequence}`,
    sequence,
    cursor: `runtime-events:${sequence}`,
    requestType: "skill.repair",
    priority: "high",
    subject: {
      kind: "skill_candidate",
      id: `candidate_${sequence}`,
      revision: "2",
    },
    reasonCode: "VALIDATION_FAILED",
    errorCodes: ["USER_SKILL_PRIMITIVE_ABI_UNSUPPORTED"],
    contextRefs: [
      {
        kind: "skill_candidate",
        id: `candidate_${sequence}`,
        revision: "2",
      },
    ],
    allowedActions: [
      "candidate.inspect",
      "candidate.revise",
      "candidate.validate",
    ],
    requiresUserConfirmation: true,
    dedupeKey: `runtime:agent_request_v1:skill_candidate:${sequence}`,
    occurredAt: "2026-09-29T19:00:00.000Z",
  };
}

function withdrawal(sequence = 101, sourceSequence = 100) {
  return {
    eventType: "agent_request.withdrawn",
    eventId: `evt_agent_${sequence}`,
    proposalId: `proposal_skill_${sourceSequence}`,
    sequence,
    cursor: `runtime-events:${sequence}`,
    subject: {
      kind: "skill_candidate",
      id: `candidate_${sourceSequence}`,
      revision: "2",
    },
    reasonCode: "ISSUE_RESOLVED",
    dedupeKey: `runtime:agent_request_v1:skill_candidate:${sourceSequence}`,
    occurredAt: "2026-09-29T19:01:00.000Z",
  };
}

function capabilities(supported = true) {
  return {
    extensions: supported
      ? {
          publicEventJournal: { version: 1 },
          agentRequestProducer: { version: 1 },
        }
      : {},
  };
}

function page(events, {
  nextCursor = events.at(-1)?.cursor ?? "runtime-events:0",
  hasMore = false,
  oldestSequence = events[0]?.sequence ?? null,
  newestSequence = events.at(-1)?.sequence ?? null,
} = {}) {
  return {
    events,
    nextCursor,
    hasMore,
    retention: {
      strategy: "count",
      maxEvents: 10_000,
      oldestSequence,
      newestSequence,
      oldestCursor:
        oldestSequence === null ? null : `runtime-events:${oldestSequence}`,
      newestCursor:
        newestSequence === null ? null : `runtime-events:${newestSequence}`,
    },
  };
}

function setup(clientOverrides = {}) {
  const dir = makeScratch();
  const inbox = new AgentInboxStore({
    file: path.join(dir, "agent-inbox.json"),
  });
  const consumer = new RuntimeAgentRequestEventConsumer({
    inbox,
    stateFile: path.join(dir, "runtime-agent-request-consumer.json"),
  });
  const client = {
    capabilities: vi.fn(async () => capabilities(true)),
    listEvents: vi.fn(async () => page([])),
    ...clientOverrides,
  };
  const bridge = new RuntimeAgentRequestEventBridge({
    client,
    consumer,
    inbox,
    stateFile: path.join(dir, "runtime-agent-request-event-bridge.json"),
    pollIntervalMs: 60_000,
  });
  return { dir, inbox, consumer, client, bridge };
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("RuntimeAgentRequestEventBridge", () => {
  it("consumes the complete AgentRequest channel and resumes from the durable cursor", async () => {
    const first = proposal(1);
    const second = withdrawal(2, 1);
    const setupState = setup({
      listEvents: vi
        .fn()
        .mockResolvedValueOnce(page([first, second]))
        .mockResolvedValueOnce(
          page([], {
            nextCursor: "runtime-events:2",
            oldestSequence: 1,
            newestSequence: 2,
          }),
        ),
    });

    const initial = await setupState.bridge.syncOnce();

    expect(initial.status).toBe("healthy");
    expect(initial.consumer).toEqual({
      lastSequence: 2,
      lastCursor: "runtime-events:2",
    });
    expect(setupState.inbox.summary().pending).toBe(0);
    expect(setupState.client.listEvents).toHaveBeenNthCalledWith(1, {
      limit: 100,
      types: [
        "agent_request.proposed",
        "agent_request.withdrawn",
      ],
    });

    await setupState.bridge.syncOnce();

    expect(setupState.client.listEvents).toHaveBeenNthCalledWith(2, {
      afterCursor: "runtime-events:2",
      limit: 100,
      types: [
        "agent_request.proposed",
        "agent_request.withdrawn",
      ],
    });
  });

  it("stops at the last accepted event when a page contains an unseen sequence gap", async () => {
    const setupState = setup({
      listEvents: vi.fn(async () =>
        page([proposal(1), proposal(5)], {
          nextCursor: "runtime-events:5",
        }),
      ),
    });

    const result = await setupState.bridge.syncOnce();

    expect(result.status).toBe("needs_attention");
    expect(result.reconciliation).toMatchObject({
      reasonCode: "AGENT_REQUEST_EVENT_GAP",
      savedCursor: "runtime-events:1",
      savedSequence: 1,
      pageNextCursor: "runtime-events:5",
    });
    expect(setupState.consumer.readState()).toMatchObject({
      lastSequence: 1,
      lastCursor: "runtime-events:1",
    });
    expect(setupState.inbox.summary().pending).toBe(1);

    await setupState.bridge.syncOnce();
    expect(setupState.client.listEvents).toHaveBeenCalledTimes(1);
  });

  it("enters durable reconciliation on retention gap and never jumps to newest cursor", async () => {
    const expired = Object.assign(
      new Error(
        "CURSOR_EXPIRED: RETENTION_GAP requested=1 oldestRetained=50.",
      ),
      {
        code: "CURSOR_EXPIRED",
        runtimeResponded: true,
      },
    );
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce(page([proposal(1)]))
      .mockRejectedValue(expired);

    const setupState = setup({ listEvents });
    await setupState.bridge.syncOnce();

    expect(setupState.consumer.readState().lastCursor).toBe(
      "runtime-events:1",
    );

    const gap = await setupState.bridge.syncOnce();
    expect(gap.status).toBe("needs_attention");
    expect(gap.reconciliation).toMatchObject({
      reasonCode: "CURSOR_EXPIRED",
      savedCursor: "runtime-events:1",
      savedSequence: 1,
      requestedSequence: 1,
      oldestRetainedSequence: 50,
    });

    await setupState.bridge.syncOnce();
    expect(listEvents).toHaveBeenCalledTimes(2);

    await setupState.bridge.retrySavedCursor();
    expect(listEvents).toHaveBeenCalledTimes(3);
    expect(listEvents).toHaveBeenNthCalledWith(3, {
      afterCursor: "runtime-events:1",
      limit: 100,
      types: [
        "agent_request.proposed",
        "agent_request.withdrawn",
      ],
    });

    const afterRetry = setupState.bridge.snapshot();
    expect(afterRetry.status).toBe("needs_attention");
    expect(afterRetry.consumer.lastCursor).toBe("runtime-events:1");
  });

  it("preserves needs-attention when explicit retry encounters a transient transport failure", async () => {
    const cursorAhead = Object.assign(
      new Error("CURSOR_AHEAD: requested=1 newest=0."),
      {
        code: "CURSOR_AHEAD",
        runtimeResponded: true,
      },
    );
    const transient = Object.assign(new Error("connection refused"), {
      code: "ECONNREFUSED",
    });
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce(page([proposal(1)]))
      .mockRejectedValueOnce(cursorAhead)
      .mockRejectedValueOnce(transient);

    const setupState = setup({ listEvents });
    await setupState.bridge.syncOnce();
    await setupState.bridge.syncOnce();

    const retry = await setupState.bridge.retrySavedCursor();
    expect(retry.status).toBe("needs_attention");
    expect(retry.reconciliation.reasonCode).toBe("CURSOR_AHEAD");
    expect(retry.reconciliation.savedCursor).toBe("runtime-events:1");
  });

  it("treats malformed Runtime event positions as replay-integrity needs-attention", async () => {
    const malformed = {
      ...proposal(1),
      cursor: "runtime-events:999",
    };
    const setupState = setup({
      listEvents: vi.fn(async () =>
        page([malformed], {
          nextCursor: "runtime-events:999",
          oldestSequence: 1,
          newestSequence: 1,
        }),
      ),
    });

    const result = await setupState.bridge.syncOnce();

    expect(result.status).toBe("needs_attention");
    expect(result.reconciliation).toMatchObject({
      reasonCode: "AGENT_REQUEST_EVENT_POSITION_INVALID",
      savedCursor: null,
      savedSequence: null,
      pageNextCursor: "runtime-events:999",
    });
    expect(setupState.consumer.readState()).toMatchObject({
      lastSequence: null,
      lastCursor: null,
    });
    expect(setupState.inbox.summary().pending).toBe(0);
  });

  it("does not call events.list when Runtime does not expose both optional extensions", async () => {
    const setupState = setup({
      capabilities: vi.fn(async () => capabilities(false)),
    });

    const result = await setupState.bridge.syncOnce();

    expect(result.status).toBe("unsupported");
    expect(result.supported).toBe(false);
    expect(setupState.client.listEvents).not.toHaveBeenCalled();
  });

  it("fails closed when Runtime Inbox history exists but the local event checkpoint disappeared", async () => {
    const setupState = setup();
    setupState.inbox.create({
      type: "skill.repair",
      producer: "runtime",
      priority: "normal",
      subject: {
        kind: "skill_candidate",
        id: "candidate_existing",
        revision: "2",
      },
      reasonCode: "VALIDATION_FAILED",
      errorCodes: [],
      contextRefs: [],
      allowedActions: ["candidate.inspect"],
      requiresUserConfirmation: true,
      correlationId: "proposal_existing",
      dedupeKey: "runtime:existing",
    });

    const result = await setupState.bridge.syncOnce();

    expect(result.status).toBe("needs_attention");
    expect(result.reconciliation.reasonCode).toBe(
      "LOCAL_RUNTIME_EVENT_CHECKPOINT_MISSING",
    );
    expect(setupState.client.listEvents).not.toHaveBeenCalled();
  });

  it("requires reconciliation when first replay begins above journal genesis", async () => {
    const setupState = setup({
      listEvents: vi.fn(async () =>
        page([proposal(50)], {
          nextCursor: "runtime-events:50",
          oldestSequence: 50,
          newestSequence: 50,
        }),
      ),
    });

    const result = await setupState.bridge.syncOnce();

    expect(result.status).toBe("needs_attention");
    expect(result.reconciliation).toMatchObject({
      reasonCode: "RUNTIME_EVENT_HISTORY_TRUNCATED_BEFORE_FIRST_CHECKPOINT",
      savedCursor: null,
      savedSequence: null,
      oldestRetainedSequence: 50,
      pageNextCursor: "runtime-events:50",
    });
    expect(setupState.consumer.readState()).toMatchObject({
      lastSequence: null,
      lastCursor: null,
    });
    expect(setupState.inbox.summary().pending).toBe(0);

    await setupState.bridge.syncOnce();
    expect(setupState.client.listEvents).toHaveBeenCalledTimes(1);
  });

  it("persists reconciliation across bridge restart", async () => {
    const expired = Object.assign(
      new Error(
        "CURSOR_EXPIRED: RETENTION_GAP requested=1 oldestRetained=50.",
      ),
      { code: "CURSOR_EXPIRED", runtimeResponded: true },
    );
    const setupState = setup({
      listEvents: vi
        .fn()
        .mockResolvedValueOnce(page([proposal(1)]))
        .mockRejectedValueOnce(expired),
    });

    await setupState.bridge.syncOnce();
    await setupState.bridge.syncOnce();

    const restarted = new RuntimeAgentRequestEventBridge({
      client: setupState.client,
      consumer: setupState.consumer,
      inbox: setupState.inbox,
      stateFile: path.join(
        setupState.dir,
        "runtime-agent-request-event-bridge.json",
      ),
      pollIntervalMs: 60_000,
    });

    const snapshot = restarted.snapshot();
    expect(snapshot.status).toBe("needs_attention");
    expect(snapshot.reconciliation).toMatchObject({
      reasonCode: "CURSOR_EXPIRED",
      savedCursor: "runtime-events:1",
    });

    await restarted.syncOnce();
    expect(setupState.client.listEvents).toHaveBeenCalledTimes(2);
  });
});
