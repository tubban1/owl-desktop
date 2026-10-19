import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

describe("Planner Continuation durable compact storage", () => {
  it("reads an existing pretty JSON snapshot, writes a lossless compact replacement and remains restart-readable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-compact-state-"));
    roots.push(root);
    const file = path.join(root, "planner.json");
    const oldState = { version: 1, owners: {}, handoffs: { h1: { id: "h1", label: "Keep me" } } };
    for (let i = 0; i < 120; i += 1) {
      oldState.owners["owner-" + i] = {
        ownerId: "owner-" + i,
        checkpoint: { goal: "Preserve goal " + i, summary: "abc def ghi ".repeat(50) },
        workstream: { goal: "Original goal " + i, status: "active", recentTools: [] },
        transports: {},
      };
    }
    const legacy = JSON.stringify(oldState, null, 2) + "\n";
    fs.writeFileSync(file, legacy);
    const store = new PlannerContinuationStore({ file });
    expect(store.read()).toEqual(oldState);
    store.write(store.read());
    const compact = fs.readFileSync(file, "utf8");
    expect(compact.length).toBeLessThan(legacy.length * 0.9);
    expect(JSON.parse(compact)).toEqual(oldState);
    expect(new PlannerContinuationStore({ file }).read()).toEqual(oldState);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(root)).toEqual(["planner.json"]);
  });
});
