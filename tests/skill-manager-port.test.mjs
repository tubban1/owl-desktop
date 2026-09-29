import { describe, expect, it, vi } from "vitest";
import { RuntimeSkillManagerPort } from "../electron/services/skill-manager-port.mjs";

function mockClient(overrides = {}) {
  return {
    skillCatalog: vi.fn(async () => [
      {
        id: "runtime.identity",
        domain: "runtime",
        description: "Identity",
        contract: {
          riskLevel: "low",
          idempotent: true,
          sideEffects: [],
          requiresVerification: false,
          retryPolicy: "automatic",
          resources: [],
        },
        inputs: {},
        skillVersion: "0.1.0",
        requiredPrimitiveAbi: 1,
        requiredPrimitives: [],
        executionMode: "inline",
        memoryPolicy: { working: "runtime" },
      },
      {
        id: "demo.browser",
        domain: "demo",
        description: "Needs browser",
        contract: {
          riskLevel: "high",
          idempotent: false,
          sideEffects: ["external_interaction"],
          requiresVerification: true,
          retryPolicy: "manual",
          resources: [],
        },
        inputs: { url: "Target URL" },
        skillVersion: "1.0.0",
        requiredPrimitiveAbi: 1,
        requiredPrimitives: ["web.query"],
        executionMode: "inline",
        memoryPolicy: { working: "runtime" },
      },
    ]),
    primitiveCatalog: vi.fn(async () => [
      { id: "provider.status", abiVersion: 1 },
    ]),
    capabilities: vi.fn(async () => ({
      architecture: { primitiveAbi: { version: 1 } },
      providers: [
        {
          id: "browser",
          label: "Browser",
          enabled: false,
          available: true,
          capabilities: ["browser"],
          executionTargets: ["host"],
        },
      ],
    })),
    runSkill: vi.fn(async (request) => ({ request })),
    ...overrides,
  };
}

describe("RuntimeSkillManagerPort", () => {
  it("maps Runtime catalog into a Desktop view model without inventing registry state", async () => {
    const port = new RuntimeSkillManagerPort({ client: mockClient() });
    const snapshot = await port.snapshot();

    expect(snapshot.source).toBe("runtime-1.0");
    expect(snapshot.summary.installed).toBe(2);
    expect(snapshot.summary.ready).toBe(1);
    expect(snapshot.summary.needsAttention).toBe(1);
    expect(snapshot.lifecycle).toEqual({
      registrySupported: false,
      candidatesSupported: false,
      librarySupported: false,
      reason: "Requires Runtime 1.x Skill Registry",
    });
    expect(snapshot.skills[0]).toMatchObject({
      id: "runtime.identity",
      source: "builtin",
      availability: "ready",
      enabled: true,
    });
    expect(snapshot.skills[1]).toMatchObject({
      id: "demo.browser",
      availability: "missing_capability",
      requiredPrimitives: ["web.query"],
    });
    expect(snapshot.skills[1].lifecycle.canInstall).toBe(false);
  });

  it("forwards dry-run and run to canonical Runtime skill.run", async () => {
    const client = mockClient();
    const port = new RuntimeSkillManagerPort({ client });

    await port.dryRun("runtime.identity", { a: 1 });
    await port.run("runtime.identity", { b: 2 });

    expect(client.runSkill).toHaveBeenNthCalledWith(1, {
      skill: "runtime.identity",
      args: { a: 1 },
      dryRun: true,
    });
    expect(client.runSkill).toHaveBeenNthCalledWith(2, {
      skill: "runtime.identity",
      args: { b: 2 },
      dryRun: false,
    });
  });

  it("marks higher Primitive ABI requirements incompatible", async () => {
    const client = mockClient({
      skillCatalog: vi.fn(async () => [
        {
          id: "future.skill",
          contract: {},
          requiredPrimitiveAbi: 2,
          requiredPrimitives: [],
          skillVersion: "1.0.0",
          executionMode: "inline",
        },
      ]),
    });
    const port = new RuntimeSkillManagerPort({ client });
    const snapshot = await port.snapshot();

    expect(snapshot.skills[0].availability).toBe("incompatible");
    expect(snapshot.skills[0].availabilityReasons[0]).toContain("Primitive ABI 2");
  });
});
