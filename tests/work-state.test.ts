import { describe, expect, it } from "vitest";
import { deriveWorkState } from "../src/workState";

const ready = {
  title: "OWL LAB is ready",
  description: "Ready.",
};

const base = {
  taskRows: [],
  runningProcesses: [],
  readinessReady: true,
  productReadiness: ready,
  runtimeEventNeedsAttention: false,
  runtimeEventStatus: null,
  claimedAgentRequests: [],
  pendingAgentRequests: [],
  wakeName: "OWL",
  checkedAt: "2026-10-01T15:00:00.000Z",
  now: Date.parse("2026-10-01T15:10:00.000Z"),
};

describe("deriveWorkState", () => {
  it("shows idle when Runtime is ready and no work is active", () => {
    expect(deriveWorkState(base)).toMatchObject({
      state: "idle",
      label: "Idle",
      title: "OWL is ready for work",
      signal: "Ready for a new request",
    });
  });

  it("shows working for a live managed process", () => {
    const state = deriveWorkState({
      ...base,
      runningProcesses: [{
        running: true,
        command: "sleep 10",
        startedAt: "2026-10-01T15:09:53.000Z",
      }],
    });
    expect(state).toMatchObject({
      state: "working",
      title: "Background process running",
      detail: "sleep 10",
      signal: "Running for 7s",
    });
  });

  it("shows waiting approval as deliberate waiting rather than stuck", () => {
    const state = deriveWorkState({
      ...base,
      taskRows: [{
        label: "Publish release",
        status: "waiting_approval",
        counts: { waitingApproval: 1 },
        updatedAt: "2026-10-01T15:09:00.000Z",
      }],
    });
    expect(state).toMatchObject({
      state: "waiting",
      label: "Waiting",
      title: "Publish release",
      detail: "Waiting for your approval before continuing.",
      signal: "Not stuck — waiting deliberately",
    });
  });

  it("shows a fresh running task as working with bounded progress", () => {
    const state = deriveWorkState({
      ...base,
      taskRows: [{
        label: "Build release",
        status: "running",
        progress: {
          phase: "running",
          lastMeaningfulAt: "2026-10-01T15:09:50.000Z",
          recommendedPollAfterMs: 5_000,
          message: "Packaging app",
          counts: { total: 4, succeeded: 2 },
        },
      }],
    });
    expect(state).toMatchObject({
      state: "working",
      label: "Working",
      title: "Build release",
      detail: "Packaging app",
      signal: "Progress 10s ago",
      progress: 50,
    });
  });

  it("shows possibly stuck only after meaningful-progress staleness threshold", () => {
    const state = deriveWorkState({
      ...base,
      taskRows: [{
        label: "Long validation",
        status: "running",
        progress: {
          phase: "running",
          lastMeaningfulAt: "2026-10-01T15:07:00.000Z",
          recommendedPollAfterMs: 5_000,
          message: "Still validating",
          counts: { total: 5, succeeded: 1 },
        },
      }],
    });
    expect(state).toMatchObject({
      state: "possibly_stuck",
      label: "Possibly stuck",
      title: "Long validation",
      signal: "No meaningful progress for 3m",
      progress: 20,
    });
  });

  it("shows failed task as needs attention", () => {
    const state = deriveWorkState({
      ...base,
      taskRows: [{
        label: "Deploy package",
        status: "failed",
        progress: {
          message: "Package verification failed",
          lastMeaningfulAt: "2026-10-01T15:09:30.000Z",
        },
      }],
    });
    expect(state).toMatchObject({
      state: "needs_attention",
      label: "Needs attention",
      title: "Deploy package",
      detail: "Package verification failed",
      signal: "Task stopped",
    });
  });

  it("shows durable history reconciliation as needs attention", () => {
    const state = deriveWorkState({
      ...base,
      runtimeEventNeedsAttention: true,
      runtimeEventStatus: {
        version: 1,
        status: "needs_attention",
        supported: true,
        running: false,
        pollIntervalMs: 3000,
        lastPollAt: "2026-10-01T15:09:55.000Z",
        lastSuccessAt: "2026-10-01T15:09:00.000Z",
        lastErrorCode: "EVENT_GAP",
        lastErrorMessage: "History gap",
        acceptedEvents: 4,
        acceptedPages: 1,
        retention: null,
        reconciliation: {
          reasonCode: "CURSOR_EXPIRED",
          message: "Saved cursor is outside retained history.",
          detectedAt: "2026-10-01T15:09:55.000Z",
          savedCursor: "old",
          savedSequence: 1,
        },
        consumer: {
          lastSequence: 1,
          lastCursor: "old",
        },
      },
    });
    expect(state).toMatchObject({
      state: "needs_attention",
      title: "Runtime history needs reconciliation",
      detail: "Saved cursor is outside retained history.",
      signal: "Review before continuing",
    });
  });

  it("shows readiness failure before work activity", () => {
    const state = deriveWorkState({
      ...base,
      readinessReady: false,
      productReadiness: {
        title: "Local Runtime needs attention",
        description: "OWL Runtime is not reachable.",
      },
    });
    expect(state).toMatchObject({
      state: "needs_attention",
      title: "Local Runtime needs attention",
      detail: "OWL Runtime is not reachable.",
      signal: "Action required before OWL can work",
    });
  });
});
