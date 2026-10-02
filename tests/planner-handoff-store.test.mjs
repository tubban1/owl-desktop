import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";

const roots = [];

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-planner-handoff-"));
  roots.push(root);
  return new PlannerContinuationStore({
    file: path.join(root, "planner-continuation.json"),
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Planner Handoff store", () => {
  it("creates one bounded ready handoff from the active workstream", () => {
    const store = createStore();
    const source = store.openWorkstream(
      {
        goal: "Ship OWL LAB 1.1 continuity",
        label: "OWL LAB",
        clientKind: "chatgpt",
        workspace: {
          repo: "owl-desktop",
          worktree: "/tmp/owl-desktop",
          commit: "abc123",
        },
      },
      "2026-10-02T14:00:00.000Z",
    );

    store.checkpoint(
      source.ownerId,
      {
        goal: "Ship OWL LAB 1.1 continuity",
        phase: "handoff foundation",
        summary: "Store and MCP contract are next.",
        completed: ["1.0 foundation frozen"],
        nextActions: ["add handoff tools", "run cross-chat E2E"],
        workspace: {
          repo: "owl-desktop",
          worktree: "/tmp/owl-desktop",
          commit: "abc123",
        },
        orchestrationId: "orch_continuity",
        taskIds: ["task_812"],
        decisions: ["Runtime remains execution truth"],
        constraints: ["Do not reopen Runtime 1.0 features"],
        doNotRepeat: ["Do not create a replacement task"],
      },
      "2026-10-02T14:01:00.000Z",
    );

    const handoff = store.prepareHandoff(
      source.ownerId,
      {
        project: "OWL LAB",
        reason: "continuity_high",
        continuityRisk: "high",
        evidenceRefs: [
          { kind: "verification", id: "verify_1", label: "Desktop gate" },
        ],
      },
      "2026-10-02T14:02:00.000Z",
    );

    expect(handoff).toMatchObject({
      status: "ready",
      project: "OWL LAB",
      reason: "continuity_high",
      continuityRisk: "high",
      sourceOwnerId: source.ownerId,
      sourceWorkstreamId: source.ownerId,
      sourceCheckpointRevision: 2,
      capsule: {
        goal: "Ship OWL LAB 1.1 continuity",
        phase: "handoff foundation",
        taskIds: ["task_812"],
        decisions: ["Runtime remains execution truth"],
        constraints: ["Do not reopen Runtime 1.0 features"],
        doNotRepeat: ["Do not create a replacement task"],
      },
      evidenceRefs: [
        { kind: "verification", id: "verify_1", label: "Desktop gate" },
      ],
    });

    expect(store.latestHandoff({ project: "OWL LAB" })).toEqual(handoff);
    expect(store.latestHandoff({ project: "Another project" })).toBeNull();
    expect(store.summary()).toMatchObject({
      readyHandoffCount: 1,
      latestReadyHandoff: {
        id: handoff.id,
        sourceWorkstreamId: source.ownerId,
      },
    });
  });

  it("refreshes a ready handoff instead of duplicating one workstream", () => {
    const store = createStore();
    const source = store.openWorkstream(
      { goal: "Continue one logical task", clientKind: "chatgpt" },
      "2026-10-02T14:00:00.000Z",
    );

    const first = store.prepareHandoff(
      source.ownerId,
      { project: "OWL LAB", continuityRisk: "high" },
      "2026-10-02T14:01:00.000Z",
    );
    const second = store.prepareHandoff(
      source.ownerId,
      {
        project: "OWL LAB",
        continuityRisk: "critical",
        decisions: ["Keep the same Runtime task"],
      },
      "2026-10-02T14:02:00.000Z",
    );

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe("2026-10-02T14:02:00.000Z");
    expect(second.continuityRisk).toBe("critical");
    expect(second.capsule.decisions).toEqual(["Keep the same Runtime task"]);
    expect(store.summary().readyHandoffCount).toBe(1);
  });

  it("removes a consumed handoff from latest discovery but keeps its receipt", () => {
    const store = createStore();
    const source = store.openWorkstream({
      goal: "Resume across conversations",
      clientKind: "chatgpt",
    });
    const handoff = store.prepareHandoff(source.ownerId, {
      project: "OWL LAB",
    });

    const consumed = store.consumeHandoff(
      handoff.id,
      "owl-owner:new-chat",
      "2026-10-02T14:03:00.000Z",
    );

    expect(consumed).toMatchObject({
      alreadyConsumed: false,
      handoff: {
        id: handoff.id,
        status: "consumed",
        consumedAt: "2026-10-02T14:03:00.000Z",
        consumedByOwnerId: "owl-owner:new-chat",
      },
    });
    expect(store.latestHandoff({ project: "OWL LAB" })).toBeNull();
    expect(store.getHandoff(handoff.id)).toMatchObject({ status: "consumed" });
    expect(
      store.consumeHandoff(handoff.id, "owl-owner:new-chat").alreadyConsumed,
    ).toBe(true);
  });
});
