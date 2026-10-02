import { describe, expect, it } from "vitest";
import { buildWorkstreamBoard } from "../src/monitor/workstreamModel";

function snapshot() {
  return {
    mode: "live",
    checkedAt: "2026-10-02T00:00:30.000Z",
    latencyMs: 10,
    info: { apiVersion: "0.1", runtimeVersion: "1.0.0-rc.4" },
    runtimeAccess: null,
    health: {},
    approvals: [],
    processes: [],
    diagnostics: {},
    error: null,
    metrics: { tasks: 2, approvals: 0, processes: 0 },
    tasks: [
      {
        id: "task_a",
        label: "Build Desktop",
        ownerSessionId: "owl-owner:a",
        status: "running",
        updatedAt: "2026-10-02T00:00:25.000Z",
        counts: { total: 4, succeeded: 2, running: 1 },
        progress: { message: "Running Desktop tests" },
      },
      {
        id: "task_b",
        label: "Research billing",
        ownerSessionId: "owl-owner:b",
        status: "pending",
        updatedAt: "2026-10-02T00:00:20.000Z",
        counts: { total: 2, succeeded: 0, running: 0 },
      },
    ],
    mcp: {
      status: "running",
      url: "http://127.0.0.1:8790/mcp",
      error: null,
      sessionCount: 2,
      sessions: [
        {
          transportSessionId: "transport-a",
          runtimeSessionId: "owl-owner:a",
          ownerStable: true,
          ownerSource: "explicit-header",
          clientKind: "chatgpt",
          clientLabel: "Chat A",
          createdAt: "2026-10-02T00:00:00.000Z",
          lastSeenAt: "2026-10-02T00:00:29.000Z",
        },
        {
          transportSessionId: "transport-b",
          runtimeSessionId: "owl-owner:b",
          ownerStable: true,
          ownerSource: "explicit-header",
          clientKind: "worker",
          clientLabel: "Night Worker",
          createdAt: "2026-10-02T00:00:05.000Z",
          lastSeenAt: "2026-10-02T00:00:28.000Z",
        },
      ],
      continuation: {
        activeCheckpointCount: 2,
        connectedOwnerCount: 2,
        latestActive: null,
        owners: [
          {
            ownerId: "owl-owner:a",
            clientKind: "chatgpt",
            clientLabel: "Chat A",
            ownerSource: "explicit-header",
            plannerConnected: true,
            connectedTransportCount: 1,
            lastTransportSeenAt: "2026-10-02T00:00:29.000Z",
            lastDisconnectedAt: null,
            updatedAt: "2026-10-02T00:00:15.000Z",
            checkpoint: {
              schemaVersion: 1,
              revision: 2,
              status: "active",
              goal: "Improve OWL Monitor",
              phase: "Desktop tests",
              summary: "Workstream model landed",
              completed: ["identity"],
              nextActions: ["Finish tests", "Commit"],
              workspace: null,
              orchestrationId: null,
              taskIds: ["task_a"],
              createdAt: "2026-10-02T00:00:00.000Z",
              updatedAt: "2026-10-02T00:00:15.000Z",
              completedAt: null,
            },
          },
          {
            ownerId: "owl-owner:b",
            clientKind: "worker",
            clientLabel: "Night Worker",
            ownerSource: "explicit-header",
            plannerConnected: true,
            connectedTransportCount: 1,
            lastTransportSeenAt: "2026-10-02T00:00:28.000Z",
            lastDisconnectedAt: null,
            updatedAt: "2026-10-02T00:00:18.000Z",
            checkpoint: {
              schemaVersion: 1,
              revision: 1,
              status: "waiting_runtime",
              goal: "Prepare billing research",
              phase: "Waiting for Runtime",
              summary: null,
              completed: [],
              nextActions: ["Inspect result"],
              workspace: null,
              orchestrationId: null,
              taskIds: ["task_b"],
              createdAt: "2026-10-02T00:00:05.000Z",
              updatedAt: "2026-10-02T00:00:18.000Z",
              completedAt: null,
            },
          },
        ],
        progressPolicy: {
          recommendedUpdateIntervalMs: 15000,
          recommendedMaxToolStepsWithoutUpdate: 3,
        },
      },
    },
    host: null,
    tunnel: { state: "running" },
    cloud: {
      status: "connected",
      running: true,
      configured: true,
      baseUrl: "https://example.invalid",
      deviceId: "dev_1",
      commandCounts: { processing: 0, accepted: 0, rejected: 0, uncertain: 0 },
      outboxPending: 0,
      commands: [],
    },
    agentInbox: { pending: 0, claimed: 0, highestPriority: null, byType: {} },
    runtimeEvents: {
      version: 1,
      status: "healthy",
      supported: true,
      running: true,
      pollIntervalMs: 1000,
      lastPollAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      acceptedEvents: 0,
      acceptedPages: 0,
      retention: null,
      reconciliation: null,
      consumer: { lastSequence: 0, lastCursor: null },
    },
    accounts: [],
    activity: [],
  } as any;
}

describe("buildWorkstreamBoard", () => {
  it("keeps concurrent ChatGPT and Worker owners isolated", () => {
    const board = buildWorkstreamBoard({
      snapshot: snapshot(),
      agentRequests: [],
      now: Date.parse("2026-10-02T00:00:30.000Z"),
    });

    expect(board.streams).toHaveLength(2);
    const chat = board.streams.find((stream) => stream.ownerId === "owl-owner:a");
    const worker = board.streams.find((stream) => stream.ownerId === "owl-owner:b");

    expect(chat).toMatchObject({
      sourceKind: "ChatGPT",
      sourceLabel: "Chat A",
      goal: "Improve OWL Monitor",
      currentExecutor: "OWL Runtime",
    });
    expect(chat?.tasks.map((task) => task.id)).toEqual(["task_a"]);
    expect(chat?.nextActions).toEqual(["Finish tests", "Commit"]);
    expect(chat?.messages.some((message) => message.summary === "Build Desktop")).toBe(true);

    expect(worker).toMatchObject({
      sourceKind: "Worker",
      sourceLabel: "Night Worker",
      goal: "Prepare billing research",
    });
    expect(worker?.tasks.map((task) => task.id)).toEqual(["task_b"]);
    expect(worker?.messages.some((message) => message.summary === "Build Desktop")).toBe(false);
  });

  it("surfaces real progress handoffs and the 15-second / 3-step cadence", () => {
    const input = snapshot();
    input.mcp.continuation.owners[0].workstream = {
      schemaVersion: 1,
      workstreamId: "owl-owner:a",
      status: "active",
      goal: "Improve OWL Monitor",
      label: "Chat A",
      clientKind: "chatgpt",
      clientLabel: "Chat A",
      createdAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:29.000Z",
      completedAt: null,
      lastProgressAt: "2026-10-02T00:00:29.000Z",
      toolStepsSinceProgress: 3,
      totalToolSteps: 8,
      progressEvents: [
        {
          eventId: "progress_a",
          at: "2026-10-02T00:00:29.000Z",
          status: "active",
          completed: ["Identity isolation"],
          current: "Running tests",
          nextActions: ["Commit"],
          summary: "Identity isolation done; tests running.",
        },
      ],
      recentTools: [],
    };

    const board = buildWorkstreamBoard({
      snapshot: input,
      agentRequests: [],
      now: Date.parse("2026-10-02T00:00:31.000Z"),
    });
    const chat = board.streams.find((stream) => stream.ownerId === "owl-owner:a");

    expect(chat?.progressPolicy).toMatchObject({
      intervalMs: 15000,
      maxToolSteps: 3,
      toolStepsSinceProgress: 3,
      updateRecommended: true,
    });
    expect(chat?.messages).toContainEqual(
      expect.objectContaining({
        id: "progress_a",
        from: "Chat A",
        to: "User",
        kind: "progress",
        summary: "Identity isolation done; tests running.",
      }),
    );
    expect(chat?.nextActions).toEqual(["Commit"]);
  });

  it("keeps concurrent Cloud/Worker remote commands as independent workstreams", () => {
    const input = snapshot();
    input.cloud.commands = [
      {
        commandId: "cmd_worker_a",
        deviceId: "dev_1",
        kind: "runtime.task.create-and-start",
        origin: {
          kind: "worker",
          id: "worker_a",
          label: "Research Worker",
        },
        digest: "a",
        status: "processing",
        receivedAt: "2026-10-02T00:00:20.000Z",
        updatedAt: "2026-10-02T00:00:20.000Z",
        runtimeTaskId: null,
        runtimeRunId: null,
        rejectionReason: null,
        lastErrorCode: null,
      },
      {
        commandId: "cmd_worker_b",
        deviceId: "dev_1",
        kind: "runtime.task.create-and-start",
        origin: {
          kind: "worker",
          id: "worker_b",
          label: "Release Worker",
        },
        digest: "b",
        status: "uncertain",
        receivedAt: "2026-10-02T00:00:21.000Z",
        updatedAt: "2026-10-02T00:00:21.000Z",
        runtimeTaskId: null,
        runtimeRunId: null,
        rejectionReason: null,
        lastErrorCode: "NETWORK",
      },
    ];

    const board = buildWorkstreamBoard({
      snapshot: input,
      agentRequests: [],
      now: Date.parse("2026-10-02T00:00:30.000Z"),
    });

    const research = board.streams.find(
      (stream) => stream.id === "cloud-command:cmd_worker_a",
    );
    const release = board.streams.find(
      (stream) => stream.id === "cloud-command:cmd_worker_b",
    );
    expect(research).toMatchObject({
      sourceKind: "Worker",
      sourceLabel: "Research Worker",
      status: "working",
    });
    expect(release).toMatchObject({
      sourceKind: "Worker",
      sourceLabel: "Release Worker",
      status: "attention",
    });
    expect(research?.messages[0]?.id).toBe("cmd_worker_a");
    expect(release?.messages[0]?.id).toBe("cmd_worker_b");
  });

  it("routes claimed AgentRequests only to their claiming owner", () => {
    const board = buildWorkstreamBoard({
      snapshot: snapshot(),
      agentRequests: [
        {
          requestId: "req_1",
          type: "repair_skill",
          producer: "runtime",
          priority: "normal",
          subject: { kind: "skill", id: "user.demo" },
          reasonCode: "VALIDATION_FAILED",
          errorCodes: [],
          contextRefs: [],
          allowedActions: [],
          requiresUserConfirmation: false,
          status: "claimed",
          claim: {
            ownerId: "owl-owner:b",
            ownerStable: true,
            claimedAt: "2026-10-02T00:00:10.000Z",
            leaseExpiresAt: "2026-10-02T00:10:10.000Z",
          },
          resolution: null,
          createdAt: "2026-10-02T00:00:10.000Z",
          updatedAt: "2026-10-02T00:00:11.000Z",
        },
      ] as any,
      now: Date.parse("2026-10-02T00:00:30.000Z"),
    });

    const chat = board.streams.find((stream) => stream.ownerId === "owl-owner:a");
    const worker = board.streams.find((stream) => stream.ownerId === "owl-owner:b");
    expect(chat?.messages.some((message) => message.id === "req_1")).toBe(false);
    expect(worker?.messages.some((message) => message.id === "req_1")).toBe(true);
  });
});
