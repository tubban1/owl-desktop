import { describe, expect, it } from "vitest";
import { buildOperationsGraphModel } from "../src/monitor/operationsGraphModel";

const now = Date.parse("2026-10-02T06:30:00.000Z");

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    mode: "live",
    checkedAt: "2026-10-02T06:30:00.000Z",
    latencyMs: 5,
    info: { apiVersion: "0.1", runtimeVersion: "1.0.0-rc.4" },
    runtimeAccess: {
      schemaVersion: 1,
      mode: "enforced",
      state: "READY",
      updatedAt: "2026-10-02T06:29:58.000Z",
      reasonCode: null,
      grant: {
        grantId: "grant_1",
        deviceId: "dev_1",
        organizationId: "org_1",
        principalId: "usr_1",
        issuedAt: "2026-10-02T05:00:00.000Z",
        expiresAt: "2026-10-02T12:00:00.000Z",
        evidenceDigest: "digest",
        source: "cloud-signed-lease",
        signatureVerified: true,
        entitlementStatus: "trial_active",
      },
    },
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
      continuation: {
        activeCheckpointCount: 0,
        connectedOwnerCount: 0,
        latestActive: null,
        owners: [],
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
      lastPollAt: "2026-10-02T06:29:59.000Z",
      lastSuccessAt: "2026-10-02T06:29:59.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      acceptedEvents: 4,
      acceptedPages: 1,
      retention: null,
      reconciliation: null,
      consumer: { lastSequence: 4, lastCursor: "c4" },
    },
    accounts: [],
    activity: [],
    ...overrides,
  } as any;
}

const emptyBoard = {
  generatedAt: "2026-10-02T06:30:00.000Z",
  activeCount: 0,
  connectedSources: 0,
  workingCount: 0,
  waitingCount: 0,
  attentionCount: 0,
  streams: [],
} as any;

function interactionActivity({
  status = "success",
  clientKind = "chatgpt",
  clientLabel = "Chat A",
}: {
  status?: "success" | "error";
  clientKind?: string;
  clientLabel?: string;
} = {}) {
  return [
    {
      id: "req",
      at: "2026-10-02T06:29:58.000Z",
      level: "info",
      source: "mcp",
      message: "MCP interaction request",
      meta: {
        eventKind: "mcp_interaction",
        interactionId: "i1",
        phase: "request",
        status: "running",
        tool: "read_file",
        clientKind,
        clientLabel,
        transportSessionId: "transport_a",
        runtimeSessionId: "owl-workstream:a",
        workstreamId: "owl-workstream:a",
        payload: JSON.stringify({
          path: "/Users/demo/project/package.json",
        }),
      },
    },
    {
      id: "res",
      at: "2026-10-02T06:29:59.000Z",
      level: status === "error" ? "error" : "info",
      source: "mcp",
      message: "MCP interaction response",
      meta: {
        eventKind: "mcp_interaction",
        interactionId: "i1",
        phase: "response",
        status,
        tool: "read_file",
        clientKind,
        clientLabel,
        transportSessionId: "transport_a",
        runtimeSessionId: "owl-workstream:a",
        workstreamId: "owl-workstream:a",
        durationMs: 12,
        payload:
          status === "error"
            ? JSON.stringify({ error: "denied" })
            : JSON.stringify({ content: "{}" }),
      },
    },
  ] as any;
}

describe("buildOperationsGraphModel", () => {
  it("builds an observed ChatGPT → MCP → access → Runtime → tool → result route", () => {
    const model = buildOperationsGraphModel({
      snapshot: baseSnapshot(),
      activity: interactionActivity(),
      board: emptyBoard,
      now,
    });

    expect(model.groups.map((group) => group.id)).toEqual([
      "sources",
      "ingress",
      "authorization",
      "runtime",
      "execution",
      "results",
    ]);
    expect(model.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "source:owl-workstream:a",
          label: "Chat A",
          kind: "source",
        }),
        expect.objectContaining({ id: "transport:mcp", kind: "transport" }),
        expect.objectContaining({
          id: "gate:runtime-access",
          kind: "authorization",
          state: "healthy",
        }),
        expect.objectContaining({ id: "runtime:local", kind: "runtime" }),
        expect.objectContaining({
          id: "tool:i1",
          kind: "tool",
          detail: "project/package.json",
        }),
        expect.objectContaining({
          id: "result:owl-workstream:a",
          kind: "result",
          label: "Success",
        }),
      ]),
    );
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "source:owl-workstream:a",
          to: "transport:mcp",
          observed: true,
        }),
        expect.objectContaining({
          from: "gate:runtime-access",
          to: "runtime:local",
        }),
        expect.objectContaining({ relation: "return" }),
      ]),
    );
    expect(model.loopPaths).toEqual([
      expect.objectContaining({
        id: "loop:owl-workstream:a",
        sourceNodeId: "source:owl-workstream:a",
        resultNodeId: "result:owl-workstream:a",
        sourceLabel: "Chat A",
        requestLabel: expect.stringContaining("read_file"),
        responseLabel: expect.stringContaining("Result"),
        state: "healthy",
        running: false,
      }),
    ]);
  });

  it("cuts the path at authorization when Runtime is locked", () => {
    const snapshot = baseSnapshot({
      runtimeAccess: {
        schemaVersion: 1,
        mode: "enforced",
        state: "LOCKED",
        updatedAt: "2026-10-02T06:29:58.000Z",
        reasonCode: "ACCOUNT_LOGGED_OUT",
        grant: null,
      },
    });

    const model = buildOperationsGraphModel({
      snapshot,
      activity: interactionActivity({ status: "error" }),
      board: emptyBoard,
      now,
    });

    expect(model.assurances.find((item) => item.id === "authorized")).toMatchObject({
      value: "Locked",
      state: "locked",
      detail: "ACCOUNT_LOGGED_OUT",
    });
    expect(
      model.edges.some(
        (edge) =>
          edge.from === "gate:runtime-access" &&
          edge.to === "runtime:local",
      ),
    ).toBe(false);
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "gate:runtime-access",
          to: "tool:i1",
          state: "locked",
        }),
      ]),
    );
  });

  it("adds Cloud Worker / Cloud Bridge / RemoteCommand only when that route is active", () => {
    const snapshot = baseSnapshot({
      mcp: {
        ...baseSnapshot().mcp,
        status: "stopped",
        sessionCount: 0,
      },
      tunnel: { state: "stopped" },
      cloud: {
        ...baseSnapshot().cloud,
        commands: [
          {
            commandId: "cmd_1",
            deviceId: "dev_1",
            kind: "runtime.task.create-and-start",
            origin: {
              kind: "worker",
              id: "worker_research",
              label: "Research Worker",
            },
            digest: "d",
            status: "processing",
            receivedAt: "2026-10-02T06:29:55.000Z",
            updatedAt: "2026-10-02T06:29:59.000Z",
            runtimeTaskId: null,
            runtimeRunId: null,
            rejectionReason: null,
            lastErrorCode: null,
          },
        ],
      },
    });

    const model = buildOperationsGraphModel({
      snapshot,
      activity: [],
      board: emptyBoard,
      now,
    });

    expect(model.groups.map((group) => group.id)).toEqual([
      "sources",
      "ingress",
      "coordination",
      "authorization",
      "runtime",
    ]);
    expect(model.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Research Worker",
          kind: "source",
        }),
        expect.objectContaining({
          id: "transport:cloud-bridge",
          kind: "cloud",
        }),
        expect.objectContaining({
          id: "command:cmd_1",
          kind: "command",
        }),
      ]),
    );
    expect(model.nodes.some((node) => node.id === "transport:mcp")).toBe(false);
  });

  it("shows a durable task after its source disconnects without inventing live traffic", () => {
    const board = {
      ...emptyBoard,
      activeCount: 1,
      streams: [
        {
          id: "owl-workstream:durable",
          ownerId: "owl-workstream:durable",
          sourceKind: "ChatGPT",
          sourceLabel: "Chat A",
          connected: false,
          transportCount: 0,
          status: "working",
          isCurrent: true,
          goal: "Run regression",
          phase: "Testing",
          summary: null,
          updatedAt: "2026-10-02T06:29:59.000Z",
          orchestrationId: null,
          currentExecutor: "OWL Runtime",
          currentAction: "Running tests",
          tasks: [
            {
              id: "task_1",
              label: "Full regression",
              status: "running",
              progressPercent: 50,
              current: "85 / 169 tests",
              updatedAt: "2026-10-02T06:29:59.000Z",
            },
          ],
          messages: [],
          nextActions: ["Verify build"],
          progressPolicy: {
            intervalMs: 15000,
            maxToolSteps: 3,
            checkpointAgeMs: 1000,
            lastProgressAt: "2026-10-02T06:29:59.000Z",
            toolStepsSinceProgress: 0,
            updateRecommended: false,
          },
        },
      ],
    } as any;

    const model = buildOperationsGraphModel({
      snapshot: baseSnapshot({
        mcp: { ...baseSnapshot().mcp, sessionCount: 0 },
      }),
      activity: [],
      board,
      now,
    });

    expect(model.assurances.find((item) => item.id === "persistent")).toMatchObject({
      value: "Active",
      state: "active",
    });
    expect(model.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "task:task_1", kind: "task" }),
      ]),
    );
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "source:owl-workstream:durable",
          to: "runtime:local",
          relation: "durable",
          label: "survives disconnect",
        }),
      ]),
    );
    expect(model.interactions).toHaveLength(0);
  });

  it("accepts future topology nodes/edges from the open flow-event contract", () => {
    const model = buildOperationsGraphModel({
      snapshot: baseSnapshot(),
      activity: [
        {
          id: "custom-node",
          at: "2026-10-02T06:29:59.000Z",
          level: "info",
          source: "worker",
          message: "Sandbox target online",
          meta: {
            eventKind: "operations_flow_node",
            nodeId: "target:sandbox-a",
            groupId: "targets",
            groupLabel: "Targets",
            groupOrder: 45,
            kind: "target",
            label: "Sandbox A",
            detail: "isolated Linux",
            state: "healthy",
            current: true,
            workstreamId: "owl-workstream:a",
          },
        },
        {
          id: "custom-edge",
          at: "2026-10-02T06:29:59.000Z",
          level: "info",
          source: "worker",
          message: "Runtime routes to sandbox",
          meta: {
            eventKind: "operations_flow_edge",
            edgeId: "edge:runtime:sandbox-a",
            from: "runtime:local",
            to: "target:sandbox-a",
            state: "active",
            relation: "execute",
            observed: true,
            workstreamId: "owl-workstream:a",
          },
        },
      ] as any,
      board: emptyBoard,
      now,
    });

    expect(model.groups.map((group) => group.id)).toContain("targets");
    expect(model.nodes).toContainEqual(
      expect.objectContaining({
        id: "target:sandbox-a",
        groupId: "targets",
        kind: "target",
        label: "Sandbox A",
      }),
    );
    expect(model.edges).toContainEqual(
      expect.objectContaining({
        id: "edge:runtime:sandbox-a",
        from: "runtime:local",
        to: "target:sandbox-a",
        state: "active",
      }),
    );
  });

  it("summarizes a completed workstream from real interactions and tasks", () => {
    const board = {
      ...emptyBoard,
      streams: [
        {
          id: "owl-workstream:a",
          ownerId: "owl-workstream:a",
          sourceKind: "ChatGPT",
          sourceLabel: "Chat A",
          connected: false,
          transportCount: 0,
          status: "disconnected",
          isCurrent: false,
          goal: "Inspect package and finish",
          phase: "Completed",
          summary: "Package inspected and task completed.",
          updatedAt: "2026-10-02T06:29:59.000Z",
          orchestrationId: null,
          currentExecutor: "OWL Runtime",
          currentAction: "Completed",
          tasks: [
            {
              id: "task_1",
              label: "Inspection",
              status: "completed",
              progressPercent: 100,
              current: "Done",
              updatedAt: "2026-10-02T06:29:59.000Z",
            },
          ],
          messages: [
            {
              id: "progress_1",
              at: "2026-10-02T06:29:58.500Z",
              from: "Chat A",
              to: "User",
              kind: "progress",
              summary: "Inspection complete",
              tone: "healthy",
            },
          ],
          nextActions: [],
          progressPolicy: {
            intervalMs: 15000,
            maxToolSteps: 3,
            checkpointAgeMs: 0,
            lastProgressAt: "2026-10-02T06:29:58.500Z",
            toolStepsSinceProgress: 0,
            updateRecommended: false,
          },
        },
      ],
    } as any;

    const activity = [
      ...interactionActivity(),
      {
        id: "warning_1",
        at: "2026-10-02T06:29:58.700Z",
        level: "warn",
        source: "mcp",
        message: "Transient warning",
        meta: {
          workstreamId: "owl-workstream:a",
          runtimeSessionId: "owl-workstream:a",
        },
      },
    ] as any;

    const model = buildOperationsGraphModel({
      snapshot: baseSnapshot(),
      activity,
      board,
      now,
    });

    expect(model.summaries).toContainEqual(
      expect.objectContaining({
        id: "owl-workstream:a",
        status: "completed",
        outcome: "Completed",
        toolCallCount: 1,
        progressCount: 1,
        errorCount: 0,
        warningCount: 1,
        taskCount: 1,
        completedTaskCount: 1,
        failedTaskCount: 0,
        summaryText: "Package inspected and task completed.",
        toolBreakdown: [
          expect.objectContaining({
            tool: "read_file",
            count: 1,
            errors: 0,
          }),
        ],
      }),
    );
  });

  it("adds live process and approval nodes from Runtime state without UI changes", () => {
    const model = buildOperationsGraphModel({
      snapshot: baseSnapshot({
        processes: [
          {
            processId: "proc_1",
            running: true,
            status: "running",
            label: "Test runner",
          },
        ],
        approvals: [
          {
            approvalId: "approval_1",
            status: "pending",
          },
        ],
      }),
      activity: [],
      board: emptyBoard,
      now,
    });

    expect(model.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "process:proc_1",
          kind: "process",
          label: "Test runner",
        }),
        expect.objectContaining({
          id: "approval:pending",
          kind: "approval",
          state: "waiting",
        }),
      ]),
    );
  });
});
