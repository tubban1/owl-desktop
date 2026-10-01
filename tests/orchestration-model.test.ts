import { describe, expect, it } from "vitest";
import { buildOrchestrationModel } from "../src/monitor/orchestrationModel";

const system = {
  generatedAt: "2026-10-01T20:00:00.000Z",
  connectivity: [],
  requests: {
    total: 1,
    pending: 1,
    claimed: 0,
    completed: 0,
    cancelled: 0,
    needsConfirmation: 0,
    highPriorityOpen: 0,
  },
  tasks: {
    total: 2,
    active: 1,
    running: 1,
    waitingApproval: 0,
    completed: 1,
    failed: 0,
    needsReview: 0,
    totalSteps: 5,
    succeededSteps: 3,
    runningSteps: 1,
  },
  verification: {
    required: 2,
    receipts: 1,
    verified: 1,
    failed: 0,
    uncertain: 0,
    missing: 1,
  },
  processes: { total: 1, running: 1, succeeded: 0, failed: 0, recovered: 0 },
  skills: {
    installed: 4,
    ready: 4,
    disabled: 0,
    needsAttention: 0,
    activeCandidates: 0,
    invalidCandidates: 0,
    installedUserSkills: 1,
    registrySupported: true,
    discoverySupported: true,
  },
  cloud: {
    connected: true,
    processing: 0,
    accepted: 2,
    rejected: 0,
    uncertain: 0,
    outboxPending: 0,
  },
  activity: { total: 0, info: 0, warn: 0, error: 0, bySource: [] },
  attention: [],
  recentTasks: [],
} as any;

const snapshot = {
  mode: "live",
  checkedAt: "2026-10-01T20:00:00.000Z",
  latencyMs: 11,
  info: { runtimeVersion: "1.0.0-rc.4" },
  tasks: [
    {
      id: "task_done",
      label: "Old completed work",
      status: "completed",
      ownerSessionId: "owner:old",
      createdAt: "2026-10-01T19:00:00.000Z",
      updatedAt: "2026-10-01T19:05:00.000Z",
      counts: {
        total: 1,
        pending: 0,
        running: 0,
        waitingApproval: 0,
        succeeded: 1,
        failed: 0,
        needsReview: 0,
      },
      verificationCounts: {
        required: 0,
        receipts: 0,
        verified: 0,
        failed: 0,
        uncertain: 0,
        missing: 0,
      },
    },
    {
      id: "task_live",
      label: "Release validation",
      status: "running",
      ownerSessionId: "owl-owner:stable-session",
      createdAt: "2026-10-01T19:50:00.000Z",
      updatedAt: "2026-10-01T20:00:00.000Z",
      counts: {
        total: 4,
        pending: 1,
        running: 1,
        waitingApproval: 0,
        succeeded: 2,
        failed: 0,
        needsReview: 0,
      },
      verificationCounts: {
        required: 2,
        receipts: 1,
        verified: 1,
        failed: 0,
        uncertain: 0,
        missing: 1,
      },
      progress: {
        phase: "executing",
        terminal: false,
        message: "Running release checks.",
      },
    },
  ],
  processes: [],
  mcp: {
    status: "running",
    sessionCount: 1,
    sessions: [],
    url: "http://127.0.0.1:8790/mcp",
    error: null,
  },
  tunnel: { state: "running" },
  cloud: {
    status: "connected",
    commandCounts: { processing: 0, accepted: 2, rejected: 0, uncertain: 0 },
    outboxPending: 0,
    commands: [],
  },
  runtimeEvents: {
    status: "healthy",
    consumer: { lastSequence: 9438, lastCursor: "runtime-events:9438" },
  },
} as any;

const detail = {
  id: "task_live",
  label: "Release validation",
  status: "running",
  ownerSessionId: "owl-owner:stable-session",
  createdAt: "2026-10-01T19:50:00.000Z",
  updatedAt: "2026-10-01T20:00:00.000Z",
  progress: {
    phase: "executing",
    terminal: false,
    counts: {
      total: 4,
      pending: 1,
      running: 1,
      waitingApproval: 0,
      succeeded: 2,
      failed: 0,
      needsReview: 0,
    },
    message: "Running release checks.",
  },
  verificationCounts: {
    required: 2,
    receipts: 1,
    verified: 1,
    failed: 0,
    uncertain: 0,
    missing: 1,
  },
  memoryLayers: {
    working: { succeededOutputs: 2 },
    staging: { artifactCount: 3 },
    episodic: { eventCount: 9 },
  },
  steps: [
    {
      id: "plan",
      action: "runtime.info",
      dependsOn: [],
      state: "succeeded",
      durationMs: 20,
      requiresVerification: false,
    },
    {
      id: "runtime-tests",
      action: "shell.exec",
      dependsOn: ["plan"],
      state: "succeeded",
      durationMs: 2000,
      requiresVerification: true,
      verification: { status: "verified" },
    },
    {
      id: "monitor-stats",
      action: "runtime.info",
      dependsOn: ["plan"],
      state: "succeeded",
      durationMs: 30,
      requiresVerification: false,
    },
    {
      id: "release",
      action: "git.commit",
      dependsOn: ["runtime-tests", "monitor-stats"],
      state: "running",
      durationMs: null,
      requiresVerification: true,
      verification: null,
    },
  ],
  events: [
    {
      at: "2026-10-01T19:50:00.000Z",
      type: "task_created",
      message: "Created persistent task.",
    },
    {
      at: "2026-10-01T19:55:00.000Z",
      type: "step_verified",
      stepId: "runtime-tests",
      message: "shell.exec postconditions verified.",
    },
    {
      at: "2026-10-01T20:00:00.000Z",
      type: "step_started",
      stepId: "release",
      message: "Started git.commit.",
    },
  ],
};

const requests = [
  {
    requestId: "req_1",
    type: "skill.repair",
    producer: "runtime",
    priority: "high",
    subject: { kind: "skill_candidate", id: "cand_1" },
    reasonCode: "VALIDATION_FAILED",
    errorCodes: ["X"],
    contextRefs: [],
    allowedActions: [],
    requiresUserConfirmation: false,
    status: "pending",
    claim: null,
    resolution: null,
    createdAt: "2026-10-01T19:58:00.000Z",
    updatedAt: "2026-10-01T19:58:00.000Z",
  },
] as any;

const skills = {
  candidates: [],
  summary: { ready: 4, installed: 4 },
} as any;

describe("buildOrchestrationModel", () => {
  it("focuses active durable work and does not invent a ChatGPT actor", () => {
    const model = buildOrchestrationModel({
      snapshot,
      agentRequests: requests,
      skillSnapshot: skills,
      activity: [],
      system,
      taskDetail: detail,
    });

    expect(model.focusTaskId).toBe("task_live");
    expect(model.headline).toMatchObject({
      label: "Release validation",
      overallPercent: 50,
      running: 1,
      waiting: 0,
      completedSteps: 2,
      totalSteps: 4,
    });
    expect(model.actors.some((actor) => actor.label === "ChatGPT")).toBe(false);
    expect(model.actors.find((actor) => actor.id === "agent-session")).toMatchObject({
      label: "Agent session",
      status: "running",
      progressPercent: 50,
    });
    expect(model.actors.find((actor) => actor.id === "desktop")?.detail).toContain(
      "9438",
    );
  });

  it("projects semantic milestones from canonical Task and AgentRequest facts", () => {
    const model = buildOrchestrationModel({
      snapshot,
      agentRequests: requests,
      skillSnapshot: skills,
      activity: [],
      system,
      taskDetail: detail,
    });

    expect(model.milestones.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Task created",
        "Postcondition verified",
        "Step started",
        "AgentRequest proposed",
      ]),
    );
    expect(
      model.milestones.find((item) => item.title === "Postcondition verified"),
    ).toMatchObject({
      source: "Runtime · runtime-tests",
      tone: "healthy",
    });
  });

  it("builds the graph only from real dependsOn edges and marks a structural critical path", () => {
    const model = buildOrchestrationModel({
      snapshot,
      agentRequests: [],
      skillSnapshot: skills,
      activity: [],
      system,
      taskDetail: detail,
    });

    expect(model.graph.edges).toEqual(
      expect.arrayContaining([
        { from: "plan", to: "runtime-tests" },
        { from: "plan", to: "monitor-stats" },
        { from: "runtime-tests", to: "release" },
        { from: "monitor-stats", to: "release" },
      ]),
    );
    expect(model.graph.nodes.find((node) => node.id === "release")).toMatchObject({
      level: 2,
      status: "running",
      verificationStatus: "missing",
    });
    expect(model.graph.criticalPathNodeIds[0]).toBe("plan");
    expect(model.graph.criticalPathNodeIds.at(-1)).toBe("release");
    expect(model.graph.criticalPathNodeIds).toHaveLength(3);
  });

  it("builds a task inspector from public Runtime detail and honors explicit task selection", () => {
    const selected = buildOrchestrationModel({
      snapshot,
      agentRequests: [],
      skillSnapshot: skills,
      activity: [],
      system,
      selectedTaskId: "task_live",
      taskDetail: detail,
    });

    expect(selected.inspector).toMatchObject({
      id: "task_live",
      currentAction: "git.commit",
      progressPercent: 50,
      nextStep: null,
      verification: {
        required: 2,
        receipts: 1,
        verified: 1,
        missing: 1,
      },
      memory: {
        eventCount: 9,
        stagedArtifacts: 3,
        workingOutputs: 2,
      },
    });

    const history = buildOrchestrationModel({
      snapshot,
      agentRequests: [],
      skillSnapshot: skills,
      activity: [],
      system,
      selectedTaskId: "task_done",
      taskDetail: null,
    });
    expect(history.focusTaskId).toBe("task_done");
    expect(history.headline.label).toBe("Old completed work");
  });
});
