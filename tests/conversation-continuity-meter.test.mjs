import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";

const roots = [];

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-continuity-meter-"));
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

describe("Conversation Continuity Meter", () => {
  it("starts low and labels token-equivalent volume as a heuristic", () => {
    const store = createStore();
    const owner = store.openWorkstream(
      {
        goal: "Measure only OWL-observed traffic",
        clientKind: "chatgpt",
      },
      "2026-10-02T14:00:00.000Z",
    );

    const status = store.continuityStatus(
      owner.ownerId,
      Date.parse("2026-10-02T14:01:00.000Z"),
    );

    expect(status).toMatchObject({
      modelVersion: 2,
      basis: "owl_observed_mcp_traffic",
      risk: "low",
      state: "healthy",
      score: 0,
      observedChars: 0,
      observedTokenEquivalent: 0,
      tokenEquivalentHeuristic: "characters_divided_by_4_not_openai_context",
      handoffReady: false,
    });
  });

  it("raises explainable risk from traffic, duplication, age and stale active work", () => {
    const store = createStore();
    const owner = store.openWorkstream(
      {
        goal: "Long OWL session",
        clientKind: "chatgpt",
      },
      "2026-10-02T12:00:00.000Z",
    );
    store.checkpoint(
      owner.ownerId,
      {
        goal: "Long OWL session",
        nextActions: ["continue"],
        taskIds: ["task_812"],
      },
      "2026-10-02T13:35:00.000Z",
    );
    for (let index = 0; index < 50; index += 1) {
      store.recordWorkstreamToolStep(
        owner.ownerId,
        {
          tool: "read_file",
          outcome: "success",
          durationMs: 10,
        },
        "2026-10-02T13:50:00.000Z",
      );
    }

    store.recordConversationTraffic(
      owner.ownerId,
      {
        tool: "read_file",
        requestChars: 100_000,
        responseChars: 800_000,
        requestDigest: "request-a",
        responseDigest: "response-a",
      },
      "2026-10-02T13:58:00.000Z",
    );
    const status = store.recordConversationTraffic(
      owner.ownerId,
      {
        tool: "read_file",
        requestChars: 100_000,
        responseChars: 800_000,
        requestDigest: "request-a",
        responseDigest: "response-a",
      },
      "2026-10-02T14:00:00.000Z",
    );

    expect(status.risk).toBe("critical");
    expect(status.state).toBe("handoff_recommended");
    expect(status.observedChars).toBe(1_800_000);
    expect(status.observedTokenEquivalent).toBe(450_000);
    expect(status.recentGrowthChars).toBe(1_800_000);
    expect(status.duplicateChars).toBe(900_000);
    expect(status.duplicateRatio).toBe(0.5);
    expect(status.toolCallCount).toBe(50);
    expect(status.activeTaskCount).toBe(1);
    expect(status.reasons.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "observed_volume",
        "growth_rate",
        "tool_calls",
        "session_age",
        "duplicate_payload",
        "stale_checkpoint",
        "active_durable_work",
      ]),
    );

    store.prepareHandoff(
      owner.ownerId,
      {
        project: "OWL LAB",
        continuityRisk: status.risk,
        reason: "continuity_critical",
      },
      "2026-10-02T14:00:01.000Z",
    );

    expect(
      store.continuityStatus(
        owner.ownerId,
        Date.parse("2026-10-02T14:00:02.000Z"),
      ),
    ).toMatchObject({
      risk: "critical",
      state: "handoff_ready",
      handoffReady: true,
    });
  });

  it("recommends a handoff before a real long-workstream traffic floor becomes unsafe", () => {
    const store = createStore();
    const owner = store.openWorkstream(
      {
        goal: "Calibrate from live OWL LAB dogfood",
        clientKind: "chatgpt",
      },
      "2026-10-02T12:00:00.000Z",
    );

    for (let index = 0; index < 100; index += 1) {
      store.recordWorkstreamToolStep(
        owner.ownerId,
        { tool: "execute_command", outcome: "success", durationMs: 10 },
        "2026-10-02T13:20:00.000Z",
      );
    }
    store.recordConversationTraffic(
      owner.ownerId,
      {
        tool: "execute_command",
        requestChars: 40_000,
        responseChars: 220_000,
        requestDigest: "calibration-request",
        responseDigest: "calibration-response",
      },
      "2026-10-02T13:30:00.000Z",
    );

    const status = store.continuityStatus(
      owner.ownerId,
      Date.parse("2026-10-02T14:00:00.000Z"),
    );
    expect(status).toMatchObject({
      modelVersion: 2,
      risk: "high",
      state: "handoff_recommended",
      score: 50,
      observedChars: 260_000,
      observedTokenEquivalent: 65_000,
      recentGrowthChars: 0,
      toolCallCount: 100,
    });
    expect(status.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "observed_volume", points: 20 }),
        expect.objectContaining({ code: "tool_calls", points: 20 }),
        expect.objectContaining({ code: "session_age", points: 10 }),
      ]),
    );
  });

  it("counts exact repeated sanitized payload digests without retaining payload text", () => {
    const store = createStore();
    const owner = store.openWorkstream({
      goal: "Measure duplication",
      clientKind: "chatgpt",
    });

    store.recordConversationTraffic(owner.ownerId, {
      tool: "git_diff",
      requestChars: 100,
      responseChars: 400,
      requestDigest: "same-request",
      responseDigest: "same-response",
    });
    store.recordConversationTraffic(owner.ownerId, {
      tool: "git_diff",
      requestChars: 100,
      responseChars: 400,
      requestDigest: "same-request",
      responseDigest: "same-response",
    });

    const raw = store.read().owners[owner.ownerId].continuity;
    expect(raw.observedChars).toBe(1000);
    expect(raw.duplicateChars).toBe(500);
    expect(JSON.stringify(raw)).not.toContain("payload text");
    expect(raw.recentTraffic).toHaveLength(2);
  });
});
