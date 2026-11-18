import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { listGuidance, readGuidance } from "../mcp/guidance-library.mjs";

describe("independent versioned OWL guidance", () => {
  it("lists the Xiaohongshu playbook from the canonical MCP content folder", async () => {
    const list = await listGuidance("小红书发布");
    expect(list.registryKind).toBe("guidance-only");
    expect(list.executable).toBe(false);
    expect(list.authority).toBe("none");
    expect(list.entries.map(item => item.id)).toContain("xiaohongshu-publishing");
  });

  it("reads exact immutable versions and verified content digest", async () => {
    const xhs = await readGuidance("xiaohongshu-publishing", "1.0.0");
    expect(xhs.executable).toBe(false);
    expect(xhs.appliesTo).toContain("xhs.publish");
    expect(xhs.related).toContain("ai-content-disclosure");
    expect(xhs.content).toContain("SUBMISSION_UNCERTAIN");
    expect(createHash("sha256").update(xhs.content).digest("hex")).toBe(xhs.digest);
  });

  it("supports shared guidance without inventing an executable Runtime skill", async () => {
    const shared = await readGuidance("ai-content-disclosure");
    expect(shared.appliesTo).toEqual([]);
    expect(shared.authority).toBe("none");
    expect(shared.content).toContain("originality");
  });

  it("does not allow arbitrary file names or fake versions", async () => {
    await expect(readGuidance("../../package.json")).rejects.toThrow("GUIDANCE_NOT_FOUND");
    await expect(readGuidance("xiaohongshu-publishing", "9.9.9")).rejects.toThrow(
      "GUIDANCE_VERSION_NOT_FOUND",
    );
  });
});
