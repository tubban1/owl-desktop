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

  it("keeps Conversation Continuity independent for concurrent ChatGPT sessions", () => {
    const input = snapshot();
    input.mcp.sessions[1].clientKind = "chatgpt";
    input.mcp.sessions[1].clientLabel = "Chat B";
    input.mcp.continuation.owners[1].clientKind = "chatgpt";
    input.mcp.continuation.owners[1].clientLabel = "Chat B";

    input.mcp.continuation.owners[0].continuity = {
      modelVersion: 2,
      basis: "owl_observed_mcp_traffic",
      risk: "high",
      state: "handoff_ready",
      score: 60,
      handoffReady: true,
      observedChars: 280_000,
      observedTokenEquivalent: 70_000,
      tokenEquivalentHeuristic: "characters_divided_by_4_not_openai_context",
      recentGrowthChars: 20_000,
      recentGrowthTokenEquivalent: 5_000,
      windowMinutes: 10,
      duplicateChars: 14_000,
      duplicateRatio: 0.05,
      toolCallCount: 108,
      sessionAgeMs: 14_400_000,
      workstreamAgeMs: 14_400_000,
      continuityEpochId: "continuity:a",
      continuityEpochStartedAt: "2026-10-01T20:00:00.000Z",
      checkpointAgeMs: 10_000,
      activeTaskCount: 1,
      reasons: [{ code: "observed_volume", points: 20, detail: "context floor" }],
    };
    input.mcp.continuation.owners[0].latestHandoffId = "handoff_a";

    input.mcp.continuation.owners[1].continuity = {
      modelVersion: 2,
      basis: "owl_observed_mcp_traffic",
      risk: "low",
      state: "healthy",
      score: 0,
      handoffReady: false,
      observedChars: 32_000,
      observedTokenEquivalent: 8_000,
      tokenEquivalentHeuristic: "characters_divided_by_4_not_openai_context",
      recentGrowthChars: 4_000,
      recentGrowthTokenEquivalent: 1_000,
      windowMinutes: 10,
      duplicateChars: 0,
      duplicateRatio: 0,
      toolCallCount: 12,
      sessionAgeMs: 600_000,
      workstreamAgeMs: 600_000,
      continuityEpochId: "continuity:b",
      continuityEpochStartedAt: "2026-10-02T00:00:00.000Z",
      checkpointAgeMs: 12_000,
      activeTaskCount: 1,
      reasons: [],
    };

    const board = buildWorkstreamBoard({
      snapshot: input,
      agentRequests: [],
      now: Date.parse("2026-10-02T00:00:30.000Z"),
    });
    const chatA = board.streams.find((stream) => stream.ownerId === "owl-owner:a");
    const chatB = board.streams.find((stream) => stream.ownerId === "owl-owner:b");

    expect(chatA).toMatchObject({
      sourceKind: "ChatGPT",
      sourceLabel: "Chat A",
      latestHandoffId: "handoff_a",
      continuity: {
        risk: "high",
        state: "handoff_ready",
        handoffReady: true,
        observedTokenEquivalent: 70_000,
        toolCallCount: 108,
      },
    });
    expect(chatB).toMatchObject({
      sourceKind: "ChatGPT",
      sourceLabel: "Chat B",
      continuity: {
        risk: "low",
        state: "healthy",
        handoffReady: false,
        observedTokenEquivalent: 8_000,
        toolCallCount: 12,
      },
    });
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


  it("hides transport-only implicit MCP fragments from user-level workstreams", () => {
    const input = snapshot();
    input.mcp.sessions.push({
      transportSessionId: "transport-fragment",
      runtimeSessionId: "owl-owner:fragment",
      ownerStable: true,
      ownerSource: "transport-session",
      clientKind: "mcp",
      clientLabel: null,
      createdAt: "2026-10-02T00:00:26.000Z",
      lastSeenAt: "2026-10-02T00:00:29.500Z",
    });
    input.mcp.continuation.owners.push({
      ownerId: "owl-owner:fragment",
      clientKind: "mcp",
      clientLabel: null,
      ownerSource: "transport-session",
      plannerConnected: true,
      connectedTransportCount: 1,
      lastTransportSeenAt: "2026-10-02T00:00:29.500Z",
      lastDisconnectedAt: null,
      updatedAt: "2026-10-02T00:00:29.500Z",
      checkpoint: null,
      latestHandoffId: null,
      workstream: {
        schemaVersion: 1,
        workstreamId: "owl-owner:fragment",
        implicit: true,
        status: "active",
        goal: "Interactive OWL session",
        label: null,
        clientKind: "mcp",
        clientLabel: null,
        createdAt: "2026-10-02T00:00:26.000Z",
        updatedAt: "2026-10-02T00:00:29.500Z",
        completedAt: null,
        lastProgressAt: "2026-10-02T00:00:26.000Z",
        toolStepsSinceProgress: 1,
        totalToolSteps: 1,
        progressEvents: [],
        recentTools: [],
      },
      continuity: {
        modelVersion: 2,
        basis: "owl_observed_mcp_traffic",
        risk: "low",
        state: "healthy",
        score: 0,
        handoffReady: false,
        observedChars: 1000,
        observedTokenEquivalent: 250,
        tokenEquivalentHeuristic: "characters_divided_by_4_not_openai_context",
        recentGrowthChars: 1000,
        recentGrowthTokenEquivalent: 250,
        windowMinutes: 10,
        duplicateChars: 0,
        duplicateRatio: 0,
        toolCallCount: 1,
        sessionAgeMs: 3000,
        workstreamAgeMs: 3000,
        continuityEpochId: null,
        continuityEpochStartedAt: null,
        checkpointAgeMs: null,
        activeTaskCount: 0,
        reasons: [],
      },
    });

    const board = buildWorkstreamBoard({
      snapshot: input,
      agentRequests: [],
      now: Date.parse("2026-10-02T00:00:30.000Z"),
    });

    expect(
      board.streams.some((stream) => stream.ownerId === "owl-owner:fragment"),
    ).toBe(false);
    expect(board.streams).toHaveLength(2);
  });

  it("promotes an implicit owner back into LIVE WORKSTREAMS when durable Runtime work is active", () => {
    const input = snapshot();
    input.tasks.push({
      id: "task_fragment",
      label: "Durable fragment task",
      ownerSessionId: "owl-owner:fragment",
      status: "running",
      updatedAt: "2026-10-02T00:00:29.000Z",
      counts: { total: 1, succeeded: 0, running: 1 },
      progress: { message: "Executing durable task" },
    });
    input.mcp.continuation.owners.push({
      ownerId: "owl-owner:fragment",
      clientKind: "mcp",
      clientLabel: null,
      ownerSource: "transport-session",
      plannerConnected: false,
      connectedTransportCount: 0,
      lastTransportSeenAt: null,
      lastDisconnectedAt: "2026-10-02T00:00:28.000Z",
      updatedAt: "2026-10-02T00:00:29.000Z",
      checkpoint: null,
      latestHandoffId: null,
      workstream: {
        schemaVersion: 1,
        workstreamId: "owl-owner:fragment",
        implicit: true,
        status: "active",
        goal: "Interactive OWL session",
        label: null,
        clientKind: "mcp",
        clientLabel: null,
        createdAt: "2026-10-02T00:00:20.000Z",
        updatedAt: "2026-10-02T00:00:29.000Z",
        completedAt: null,
        lastProgressAt: "2026-10-02T00:00:20.000Z",
        toolStepsSinceProgress: 1,
        totalToolSteps: 1,
        progressEvents: [],
        recentTools: [],
      },
    });

    const board = buildWorkstreamBoard({
      snapshot: input,
      agentRequests: [],
      now: Date.parse("2026-10-02T00:00:30.000Z"),
    });

    expect(
      board.streams.find((stream) => stream.ownerId === "owl-owner:fragment"),
    ).toMatchObject({
      status: "working",
      currentExecutor: "OWL Runtime",
      tasks: [expect.objectContaining({ id: "task_fragment", status: "running" })],
    });
  });


  it("does not resurrect terminal Runtime task history as a live workstream", () => {
    const input = snapshot();
    input.tasks.push({
      id: "task_terminal_history",
      label: "Old detached E2E task",
      ownerSessionId: "owl-owner:terminal-history",
      status: "completed",
      updatedAt: "2026-10-02T00:00:29.000Z",
      counts: { total: 1, succeeded: 1, running: 0 },
      progress: {
        phase: "completed",
        terminal: true,
        message: "Indexed terminal task in global episodic memory",
      },
    });

    const board = buildWorkstreamBoard({
      snapshot: input,
      agentRequests: [],
      now: Date.parse("2026-10-02T00:00:30.000Z"),
    });

    expect(
      board.streams.some(
        (stream) => stream.ownerId === "owl-owner:terminal-history",
      ),
    ).toBe(false);
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
