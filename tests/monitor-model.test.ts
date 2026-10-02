import { describe, expect, it } from "vitest";
import { buildMonitorModel } from "../src/monitor/monitorModel";

const baseSnapshot = {
  mode: "live",
  checkedAt: "2026-10-01T18:00:00.000Z",
  latencyMs: 12,
  info: { runtimeVersion: "1.0.0-rc.4", apiVersion: "0.1" },
  runtimeAccess: null,
  health: {},
  tasks: [],
  approvals: [],
  processes: [],
  diagnostics: {},
  error: null,
  metrics: { tasks: 0, approvals: 0, processes: 0 },
  mcp: {
    status: "running",
    url: "http://127.0.0.1:8790/mcp",
    error: null,
    sessionCount: 1,
    sessions: [],
  },
  host: null,
  tunnel: {
    state: "running",
    pid: 1,
    mcpUrl: "http://127.0.0.1:8790/mcp",
    error: null,
    secretStorage: "os",
  },
  cloud: {
    status: "connected",
    deviceId: "dev_test",
    lastHeartbeatAt: null,
    lastPollAt: null,
    lastError: null,
    commandCounts: {
      processing: 0,
      accepted: 2,
      rejected: 0,
      uncertain: 0,
    },
    outboxPending: 0,
    commands: [],
  },
  agentInbox: {
    pending: 0,
    claimed: 0,
    highestPriority: null,
    byType: {},
  },
  runtimeEvents: {
    version: 1,
    status: "healthy",
    supported: true,
    running: true,
    pollIntervalMs: 1000,
    lastPollAt: "2026-10-01T18:00:00.000Z",
    lastSuccessAt: "2026-10-01T18:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    acceptedEvents: 4,
    acceptedPages: 1,
    retention: null,
    reconciliation: null,
    consumer: {
      lastSequence: 4,
      lastCursor: "runtime-events:4",
    },
  },
  accounts: [],
  activity: [],
} as any;

const skillSnapshot = {
  source: "runtime-1.x",
  fetchedAt: "2026-10-01T18:00:00.000Z",
  primitiveAbiVersion: 1,
  skills: [
    {
      id: "runtime.compile_task",
      availability: "ready",
      source: "builtin",
    },
    {
      id: "user.demo",
      availability: "disabled",
      source: "user",
    },
  ],
  primitives: [],
  providers: [],
  candidates: [
    {
      id: "candidate_bad",
      status: "active",
      validation: { valid: false },
    },
    {
      id: "candidate_old",
      status: "dismissed",
      validation: { valid: false },
    },
  ],
  userSkills: [
    {
      skillId: "user.demo",
      enabled: true,
      activeVersion: "1.0.0",
      versions: [],
      createdAt: null,
      updatedAt: null,
    },
  ],
  summary: {
    installed: 2,
    ready: 1,
    needsAttention: 0,
    disabled: 1,
    candidates: 1,
    updates: 0,
  },
  lifecycle: {
    registrySupported: true,
    candidatesSupported: true,
    discoverySupported: true,
    librarySupported: false,
    reason: "Runtime User Skill Registry v1 available",
  },
} as any;

describe("buildMonitorModel", () => {
  it("projects Requests, Tasks, Processes and Skills without inventing success metrics", () => {
    const model = buildMonitorModel({
      snapshot: {
        ...baseSnapshot,
        tasks: [
          {
            id: "task_running",
            label: "Render",
            status: "running",
            updatedAt: "2026-10-01T17:59:50.000Z",
            counts: {
              total: 4,
              pending: 2,
              running: 1,
              waitingApproval: 0,
              succeeded: 1,
              failed: 0,
              needsReview: 0,
            },
            progress: { message: "Rendering frame 2" },
            verificationCounts: {
              required: 2,
              receipts: 1,
              verified: 1,
              failed: 0,
              uncertain: 0,
              missing: 1,
            },
          },
          {
            id: "task_review",
            label: "Publish",
            status: "needs_review",
            updatedAt: "2026-10-01T17:59:40.000Z",
            counts: {
              total: 1,
              pending: 0,
              running: 0,
              waitingApproval: 0,
              succeeded: 0,
              failed: 0,
              needsReview: 1,
            },
            verificationCounts: {
              required: 1,
              receipts: 1,
              verified: 0,
              failed: 0,
              uncertain: 1,
              missing: 0,
            },
          },
          {
            id: "task_done",
            label: "Health check",
            status: "completed",
            updatedAt: "2026-10-01T17:59:30.000Z",
            counts: {
              total: 2,
              pending: 0,
              running: 0,
              waitingApproval: 0,
              succeeded: 2,
              failed: 0,
              needsReview: 0,
            },
            verificationCounts: {
              required: 2,
              receipts: 2,
              verified: 2,
              failed: 0,
              uncertain: 0,
              missing: 0,
            },
          },
        ],
        processes: [
          {
            processId: "p1",
            running: true,
            status: "running",
            exitCode: null,
            recoveredAfterRestart: false,
          },
          {
            processId: "p2",
            running: false,
            status: "exited",
            exitCode: 0,
            recoveredAfterRestart: true,
          },
        ],
      },
      agentRequests: [
        {
          requestId: "r1",
          status: "pending",
          priority: "high",
          requiresUserConfirmation: true,
        },
        {
          requestId: "r2",
          status: "completed",
          priority: "normal",
          requiresUserConfirmation: false,
        },
      ] as any,
      skillSnapshot,
      activity: [
        {
          id: "a1",
          at: "2026-10-01T18:00:00.000Z",
          level: "error",
          source: "desktop",
          message: "Historical diagnostic error",
        },
        {
          id: "a2",
          at: "2026-10-01T17:59:59.000Z",
          level: "info",
          source: "runtime",
          message: "Task updated",
        },
      ] as any,
      now: Date.parse("2026-10-01T18:00:00.000Z"),
    });

    expect(model.requests).toMatchObject({
      total: 2,
      pending: 1,
      completed: 1,
      needsConfirmation: 1,
      highPriorityOpen: 1,
    });
    expect(model.tasks).toMatchObject({
      total: 3,
      active: 2,
      running: 1,
      completed: 1,
      needsReview: 1,
      totalSteps: 7,
      succeededSteps: 3,
      runningSteps: 1,
    });
    expect(model.verification).toEqual({
      required: 5,
      receipts: 4,
      verified: 3,
      failed: 0,
      uncertain: 1,
      missing: 1,
    });
    expect(model.processes).toMatchObject({
      total: 2,
      running: 1,
      succeeded: 1,
      failed: 0,
      recovered: 1,
    });
    expect(model.skills).toMatchObject({
      installed: 2,
      ready: 1,
      disabled: 1,
      activeCandidates: 1,
      invalidCandidates: 1,
      installedUserSkills: 1,
      registrySupported: true,
      discoverySupported: true,
    });
    expect(model.attention.map((item) => item.id)).toEqual(
      expect.arrayContaining(["task-review", "agent-confirmation", "skill-attention"]),
    );
    expect(model.attention.some((item) => item.title.includes("Historical"))).toBe(
      false,
    );
    expect(model.activity).toMatchObject({
      total: 2,
      info: 1,
      error: 1,
    });
    expect(model.recentTasks[0].id).toBe("task_running");
  });

  it("surfaces durable event and Cloud uncertainty as blocking signals", () => {
    const model = buildMonitorModel({
      snapshot: {
        ...baseSnapshot,
        runtimeEvents: {
          ...baseSnapshot.runtimeEvents,
          status: "needs_attention",
          reconciliation: {
            reasonCode: "CURSOR_EXPIRED",
            message: "Saved cursor is outside retained history.",
            detectedAt: "2026-10-01T18:00:00.000Z",
            savedCursor: "runtime-events:1",
            savedSequence: 1,
          },
        },
        cloud: {
          ...baseSnapshot.cloud,
          commandCounts: {
            processing: 0,
            accepted: 2,
            rejected: 0,
            uncertain: 1,
          },
        },
      },
      agentRequests: [],
      skillSnapshot,
      activity: [],
    });

    expect(model.attention.map((item) => item.id)).toEqual(
      expect.arrayContaining(["runtime-events", "skill-attention", "cloud-uncertain"]),
    );
    expect(
      model.connectivity.find((node) => node.id === "events")?.state,
    ).toBe("attention");
  });

  it("does not report a live Tunnel process as healthy when reachability is stale", () => {
    const model = buildMonitorModel({
      snapshot: {
        ...baseSnapshot,
        tunnel: {
          ...baseSnapshot.tunnel,
          reachability: {
            state: "stale",
            localReady: false,
            controlPlane: {
              status: "degraded",
              state: "backoff",
              lastSuccess: "2026-10-01T17:58:00.000Z",
              consecutiveFailures: 4,
              failureCategory: "network",
            },
            lastProbeAt: "2026-10-01T18:00:00.000Z",
            lastHealthOkAt: "2026-10-01T17:58:00.000Z",
            lastControlPlaneOkAt: "2026-10-01T17:58:00.000Z",
            consecutiveFailures: 4,
            recovering: false,
          },
        },
      },
      agentRequests: [],
      skillSnapshot: {
        ...skillSnapshot,
        candidates: [],
        summary: {
          ...skillSnapshot.summary,
          candidates: 0,
        },
      },
      activity: [],
    });

    const tunnel = model.connectivity.find((node) => node.id === "tunnel");
    expect(tunnel?.state).toBe("attention");
    expect(tunnel?.detail).toContain("stale");
    expect(tunnel?.detail).toContain("control plane degraded");
  });

  it("keeps an idle healthy system clear even when retained history contains old errors", () => {
    const model = buildMonitorModel({
      snapshot: baseSnapshot,
      agentRequests: [],
      skillSnapshot: {
        ...skillSnapshot,
        candidates: [],
        summary: {
          ...skillSnapshot.summary,
          candidates: 0,
        },
      },
      activity: [
        {
          id: "old-error",
          at: "2026-09-30T18:00:00.000Z",
          level: "error",
          source: "cloud",
          message: "Old deployment warning",
        },
      ] as any,
    });

    expect(model.attention).toEqual([]);
    expect(model.connectivity.every((node) => node.state === "healthy")).toBe(
      true,
    );
  });
});
