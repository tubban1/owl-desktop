import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("dev:desktop exit contract", () => {
  it("propagates the first child exit so a clean Electron quit stays clean", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8"),
    );
    const command = packageJson.scripts?.["dev:desktop"];

    expect(command).toContain("concurrently -k -s first");
    expect(command).toContain("renderer,electron");
  });
});
