import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlannerContinuationStore } from "../electron/services/planner-continuation-store.mjs";

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

function stores() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-read-cache-"));
  roots.push(root);
  const file = path.join(root, "planner-continuation.json");
  return [new PlannerContinuationStore({ file }), new PlannerContinuationStore({ file }), file];
}

describe("Planner continuation read-only owner cache", () => {
  it("refreshes after another process-like store replaces the snapshot", () => {
    const [a, b] = stores();
    a.checkpoint("owner-1", { goal: "Pinned goal", phase: "first" });
    expect(a.get("owner-1")?.checkpoint.phase).toBe("first");
    expect(a.get("owner-1")?.checkpoint.phase).toBe("first");
    b.checkpoint("owner-1", { goal: "Pinned goal", phase: "second" });
    expect(a.get("owner-1")?.checkpoint.phase).toBe("second");
    a.complete("owner-1", "done");
    expect(b.get("owner-1")?.checkpoint.status).toBe("completed");
  });

  it("does not expose nested cache objects to callers", () => {
    const [a] = stores();
    a.checkpoint("owner-1", { goal: "Safe goal", phase: "original", nextActions: ["one"] });
    const first = a.get("owner-1");
    first.checkpoint.phase = "mutated";
    first.checkpoint.nextActions.push("unsafe");
    const second = a.get("owner-1");
    expect(second.checkpoint.phase).toBe("original");
    expect(second.checkpoint.nextActions).toEqual(["one"]);
  });

  it("invalidates on external deletion and replacement with identical-size data", () => {
    const [a, b, file] = stores();
    a.checkpoint("owner-1", { goal: "Size", phase: "AAAA" });
    a.get("owner-1");
    const original = fs.readFileSync(file, "utf8");
    const changed = original.replace('"AAAA"', '"BBBB"');
    expect(changed.length).toBe(original.length);
    const temp = file + ".new";
    fs.writeFileSync(temp, changed);
    fs.renameSync(temp, file);
    expect(a.get("owner-1")?.checkpoint.phase).toBe("BBBB");
    fs.rmSync(file);
    expect(a.get("owner-1")).toBeNull();
    b.checkpoint("owner-1", { goal: "Restored", phase: "new" });
    expect(a.get("owner-1")?.checkpoint.phase).toBe("new");
  });
});
