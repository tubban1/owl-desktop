import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentInboxStore } from "../electron/services/agent-inbox-store.mjs";

const scratch = [];

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-agent-inbox-"));
  scratch.push(dir);
  return new AgentInboxStore({
    file: path.join(dir, "agent-inbox.json"),
  });
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("AgentInboxStore", () => {
  it("creates a structured request without prompt/content fields", () => {
    const store = createStore();
    const created = store.create({
      type: "skill.repair",
      producer: "desktop",
      priority: "high",
      subject: {
        kind: "skill_candidate",
        id: "candidate_1",
        revision: 2,
      },
      reasonCode: "VALIDATION_FAILED",
      errorCodes: ["ABI_MISMATCH", "SIDE_EFFECTS_MISSING"],
      contextRefs: [
        { kind: "validation_report", id: "vr_1" },
      ],
      allowedActions: [
        "candidate.inspect",
        "candidate.revise",
        "candidate.validate",
      ],
      requiresUserConfirmation: true,
      dedupeKey: "skill:candidate_1:revision:2:validation",
    });

    expect(created.created).toBe(true);
    expect(created.request).toMatchObject({
      type: "skill.repair",
      producer: "desktop",
      priority: "high",
      status: "pending",
      reasonCode: "VALIDATION_FAILED",
      subject: {
        kind: "skill_candidate",
        id: "candidate_1",
        revision: "2",
      },
    });

    const raw = fs.readFileSync(store.file, "utf8");
    expect(raw).not.toContain('"prompt"');
    expect(raw).not.toContain('"instructions"');
    expect(raw).not.toContain('"content"');
  });

  it("deduplicates active requests by dedupeKey", () => {
    const store = createStore();
    const input = {
      type: "failure.explain",
      subject: { kind: "cloud_command", id: "cmd_1" },
      reasonCode: "UNCERTAIN",
      dedupeKey: "cloud:cmd_1:uncertain",
    };

    const first = store.create(input);
    const second = store.create(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.request.requestId).toBe(first.request.requestId);
    expect(store.summary().pending).toBe(1);
  });

  it("claims with a lease and only the owner may complete", () => {
    const store = createStore();
    const request = store.create({
      type: "skill.repair",
      subject: { kind: "skill_candidate", id: "candidate_2" },
      reasonCode: "VALIDATION_FAILED",
    }).request;

    const claimed = store.claim(request.requestId, {
      ownerId: "owl-owner:abc",
      ownerStable: true,
      leaseSeconds: 600,
    });

    expect(claimed.status).toBe("claimed");
    expect(claimed.claim).toMatchObject({
      ownerId: "owl-owner:abc",
      ownerStable: true,
    });

    expect(() =>
      store.complete(request.requestId, {
        ownerId: "owl-owner:other",
      }),
    ).toThrow("Only the claiming agent");

    const completed = store.complete(request.requestId, {
      ownerId: "owl-owner:abc",
      outcome: "repaired",
      resultRef: "candidate_2@revision_3",
    });

    expect(completed).toMatchObject({
      status: "completed",
      resolution: {
        outcome: "repaired",
        resultRef: "candidate_2@revision_3",
      },
    });
  });

  it("recovers an expired claim to pending", () => {
    const store = createStore();
    const request = store.create(
      {
        type: "task.failure.explain",
        subject: { kind: "runtime_task", id: "task_1" },
        reasonCode: "TASK_FAILED",
      },
      new Date("2026-09-29T10:00:00.000Z"),
    ).request;

    store.claim(request.requestId, {
      ownerId: "owl-owner:a",
      leaseSeconds: 60,
      now: new Date("2026-09-29T10:00:00.000Z"),
    });

    const listed = store.list({
      now: new Date("2026-09-29T10:02:00.000Z"),
    });

    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe("pending");
    expect(listed[0].claim).toBeNull();
  });

  it("orders pending work by priority before age", () => {
    const store = createStore();
    store.create(
      {
        type: "low.work",
        priority: "low",
        subject: { kind: "task", id: "older" },
        reasonCode: "LOW",
      },
      new Date("2026-09-29T10:00:00.000Z"),
    );
    store.create(
      {
        type: "urgent.work",
        priority: "urgent",
        subject: { kind: "task", id: "newer" },
        reasonCode: "URGENT",
      },
      new Date("2026-09-29T10:01:00.000Z"),
    );

    const listed = store.list();
    expect(listed.map((item) => item.priority)).toEqual(["urgent", "low"]);
    expect(store.summary()).toMatchObject({
      pending: 2,
      highestPriority: "urgent",
      byType: {
        "low.work": 1,
        "urgent.work": 1,
      },
    });
  });
});
