import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";

const scratch = [];

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-planner-continuation-"));
  scratch.push(dir);
  return new PlannerContinuationStore({
    file: path.join(dir, "planner-continuation.json"),
  });
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("PlannerContinuationStore", () => {
  it("persists a compact checkpoint across store reconstruction", () => {
    const store = createStore();
    const file = store.file;
    const ownerId = "owl-owner:test";
    const first = store.checkpoint(
      ownerId,
      {
        status: "active",
        goal: "Finish stream-loss recovery",
        phase: "tests",
        summary: "Implementation landed.",
        completed: ["store"],
        nextActions: ["run tests"],
        workspace: {
          repo: "owl-desktop",
          worktree: "/tmp/owl-desktop",
          commit: "abc123",
        },
        orchestrationId: "orch_recovery",
        taskIds: ["task_1"],
      },
      "2026-10-01T21:00:00.000Z",
    );

    expect(first.checkpoint).toMatchObject({
      revision: 1,
      status: "active",
      goal: "Finish stream-loss recovery",
      phase: "tests",
      nextActions: ["run tests"],
      orchestrationId: "orch_recovery",
      taskIds: ["task_1"],
    });

    const restored = new PlannerContinuationStore({ file });
    expect(restored.get(ownerId)).toEqual(first);
  });

  it("increments revisions and completes without retaining stale next actions", () => {
    const store = createStore();
    const ownerId = "owl-owner:test";
    store.checkpoint(ownerId, {
      goal: "Goal",
      nextActions: ["one", "two"],
    });
    const second = store.checkpoint(ownerId, {
      goal: "Goal",
      phase: "phase-2",
      nextActions: ["three"],
    });
    expect(second.checkpoint.revision).toBe(2);

    const completed = store.complete(ownerId, "All done.");
    expect(completed.checkpoint).toMatchObject({
      revision: 3,
      status: "completed",
      summary: "All done.",
      nextActions: [],
    });
    expect(completed.checkpoint.completedAt).toBeTruthy();
  });

  it("tracks transport disconnect separately from checkpoint durability", () => {
    const store = createStore();
    const ownerId = "owl-owner:test";
    store.checkpoint(ownerId, {
      goal: "Keep work recoverable",
      nextActions: ["resume"],
    });
    store.noteTransportConnected(
      ownerId,
      "transport-a",
      "2026-10-01T21:00:01.000Z",
    );
    expect(store.get(ownerId)).toMatchObject({
      plannerConnected: true,
      connectedTransportCount: 1,
    });

    store.noteTransportDisconnected(
      ownerId,
      "transport-a",
      "transport_close",
      "2026-10-01T21:00:02.000Z",
    );
    expect(store.get(ownerId)).toMatchObject({
      plannerConnected: false,
      connectedTransportCount: 0,
      lastDisconnectedAt: "2026-10-01T21:00:02.000Z",
      checkpoint: {
        status: "active",
        goal: "Keep work recoverable",
      },
    });
  });

  it("fails closed after MCP restart instead of preserving stale connected state", () => {
    const store = createStore();
    store.noteTransportConnected(
      "owl-owner:a",
      "transport-a",
      "2026-10-01T21:00:01.000Z",
    );
    store.noteTransportConnected(
      "owl-owner:b",
      "transport-b",
      "2026-10-01T21:00:02.000Z",
    );

    expect(store.recoverConnectedTransports(
      "mcp_restart",
      "2026-10-01T21:05:00.000Z",
    )).toBe(true);

    expect(store.get("owl-owner:a")).toMatchObject({
      plannerConnected: false,
      lastDisconnectedAt: "2026-10-01T21:05:00.000Z",
    });
    expect(store.get("owl-owner:b")).toMatchObject({
      plannerConnected: false,
      lastDisconnectedAt: "2026-10-01T21:05:00.000Z",
    });
  });

  it("summarizes only non-completed checkpoints as recoverable", () => {
    const store = createStore();
    store.checkpoint("owl-owner:a", {
      goal: "Active",
      nextActions: ["continue"],
    });
    store.checkpoint("owl-owner:b", {
      goal: "Done",
      nextActions: [],
    });
    store.complete("owl-owner:b");

    const summary = store.summary();
    expect(summary.activeCheckpointCount).toBe(1);
    expect(summary.latestActive.checkpoint.goal).toBe("Active");
    expect(summary.owners).toHaveLength(2);
    expect(summary.progressPolicy).toEqual({
      recommendedUpdateIntervalMs: 15000,
      recommendedMaxToolStepsWithoutUpdate: 3,
    });
  });

  it("preserves client metadata in the multi-owner summary", () => {
    const store = createStore();
    store.noteTransportActivity(
      "owl-owner:worker",
      "transport-worker",
      "2026-10-01T21:00:01.000Z",
      {
        clientKind: "worker",
        clientLabel: "Night Worker",
        ownerSource: "explicit-header",
      },
    );

    expect(store.summary().owners[0]).toMatchObject({
      ownerId: "owl-owner:worker",
      clientKind: "worker",
      clientLabel: "Night Worker",
      ownerSource: "explicit-header",
      plannerConnected: true,
    });
  });
});
