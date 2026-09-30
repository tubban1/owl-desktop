import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Desktop packaging contract", () => {
  it("registers the owl-desktop URL scheme for OAuth callbacks", async () => {
    const raw = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const pkg = JSON.parse(raw);
    expect(pkg.build?.protocols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schemes: expect.arrayContaining(["owl-desktop"]),
        }),
      ]),
    );
  });
});
