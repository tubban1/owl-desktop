import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CloudBridgeStore,
  cloudCommandDigest,
} from "../electron/services/cloud-bridge-store.mjs";

const scratch = [];

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-cloud-store-"));
  scratch.push(dir);
  return new CloudBridgeStore({
    file: path.join(dir, "cloud-bridge-state.json"),
  });
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("CloudBridgeStore", () => {
  it("deduplicates the same commandId and detects payload mutation", () => {
    const store = createStore();
    const command = {
      commandId: "cmd_1",
      deviceId: "dev_1",
      kind: "runtime.task.create",
      payload: {
        label: "Check repo",
        steps: [{ id: "status", action: "git.status" }],
      },
    };

    const first = store.beginCommand(command);
    const retry = store.beginCommand({
      ...command,
      payload: {
        steps: [{ action: "git.status", id: "status" }],
        label: "Check repo",
      },
    });
    const mutation = store.beginCommand({
      ...command,
      payload: {
        label: "Changed",
        steps: [{ id: "status", action: "git.status" }],
      },
    });

    expect(first.existing).toBe(false);
    expect(retry.existing).toBe(true);
    expect(retry.conflict).toBe(false);
    expect(mutation.existing).toBe(true);
    expect(mutation.conflict).toBe(true);
    expect(cloudCommandDigest(command)).toHaveLength(64);
  });

  it("turns interrupted processing into uncertain on restart", () => {
    const store = createStore();
    store.beginCommand({
      commandId: "cmd_crash",
      deviceId: "dev_1",
      kind: "runtime.task.create",
      payload: { label: "x", steps: [{ id: "s", action: "git.status" }] },
    });

    expect(store.recoverProcessingAsUncertain()).toEqual(["cmd_crash"]);
    expect(store.getCommand("cmd_crash")).toMatchObject({
      status: "uncertain",
      lastErrorCode: "DESKTOP_RESTART_DURING_RUNTIME_REQUEST",
    });
  });

  it("persists only digest/mapping metadata for command dedupe", () => {
    const store = createStore();
    store.beginCommand({
      commandId: "cmd_no_payload_copy",
      deviceId: "dev_1",
      kind: "runtime.task.create",
      payload: {
        label: "Contains user content",
        steps: [{
          id: "s",
          action: "git.status",
          args: { privateNote: "do-not-copy-into-journal" },
        }],
      },
    });
    store.markAccepted("cmd_no_payload_copy", {
      runtimeTaskId: "task_1",
    });

    const raw = fs.readFileSync(store.file, "utf8");
    expect(raw).not.toContain("do-not-copy-into-journal");
    expect(raw).not.toContain("Contains user content");
    expect(store.getCommand("cmd_no_payload_copy")).toMatchObject({
      runtimeTaskId: "task_1",
      status: "accepted",
    });
  });

  it("keeps event and telemetry outbox identities stable across retries", () => {
    const store = createStore();
    store.enqueueOutbox(
      "event",
      { eventId: "evt_1", payload: {} },
      "evt_1",
    );
    store.enqueueOutbox(
      "event",
      { eventId: "evt_1", payload: { changed: true } },
      "evt_1",
    );

    expect(store.snapshot().outboxPending).toBe(1);
    expect(store.dueOutbox()).toHaveLength(1);

    store.markOutboxFailed("evt_1", "NETWORK", 0);
    expect(store.dueOutbox()).toHaveLength(1);
    store.markOutboxDelivered(["evt_1"]);
    expect(store.snapshot().outboxPending).toBe(0);
  });
});
