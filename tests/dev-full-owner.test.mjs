import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ownerMatches, readDevOwner, removeDevOwner, writeDevOwner } from "../scripts/lib/dev-full-owner.mjs";

describe("dev:full owner identity", () => {
  it("refuses stale or unrelated records without signaling", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-dev-owner-"));
    const file = path.join(dir, "owner.json");
    try {
      expect(ownerMatches({ version: 1, desktopRoot: "/x", pid: 99999, birth: "old" }, "/x")).toBe(false);
      expect(readDevOwner(file)).toBeNull();
      const record = writeDevOwner("/owl/desktop", file);
      expect(ownerMatches(record, "/owl/desktop")).toBe(false); // test runner is not dev-full
      expect(ownerMatches(record, "/other")).toBe(false);
      removeDevOwner({ ...record, birth: "incorrect" }, file);
      expect(fs.existsSync(file)).toBe(true);
      removeDevOwner(record, file);
      expect(fs.existsSync(file)).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
