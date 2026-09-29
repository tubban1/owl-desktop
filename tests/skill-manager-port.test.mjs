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

function lifecycleClient(overrides = {}) {
  return mockClient({
    capabilities: vi.fn(async () => ({
      architecture: { primitiveAbi: { version: 1 } },
      extensions: {
        userSkillRegistry: { version: 1, status: "candidate" },
        workflowSkillDiscovery: { version: 1, status: "candidate" },
      },
      providers: [],
    })),
    skillCatalog: vi.fn(async () => [
      {
        id: "user.workflow.report-abcd1234",
        title: "Daily report",
        domain: "user",
        description: "Build report",
        source: "user",
        enabled: true,
        activeVersion: "0.1.0",
        skillVersion: "0.1.0",
        availability: "ready",
        validationErrors: [],
        contract: {
          riskLevel: "medium",
          idempotent: true,
          sideEffects: ["file_creation"],
          requiresVerification: true,
          retryPolicy: "automatic",
          resources: [],
        },
        inputs: { date: "Report date" },
        requiredPrimitiveAbi: 1,
        requiredPrimitives: ["fs.write"],
        executionMode: "durable",
      },
    ]),
    primitiveCatalog: vi.fn(async () => [
      { id: "fs.write", abiVersion: 1 },
    ]),
    listSkillCandidates: vi.fn(async () => [
      {
        version: 1,
        id: "candidate_abc",
        status: "active",
        createdAt: "2026-09-29T10:00:00.000Z",
        updatedAt: "2026-09-29T10:00:00.000Z",
        revision: 1,
        currentDigest: "digest-1",
        revisions: [],
        tests: [],
      },
    ]),
    listUserSkills: vi.fn(async () => ({
      skills: [
        {
          skillId: "user.workflow.report-abcd1234",
          enabled: true,
          activeVersion: "0.1.0",
          versions: [
            {
              version: "0.1.0",
              candidateDigest: "digest-1",
              installedAt: "2026-09-29T10:00:00.000Z",
              uninstalledAt: null,
              active: true,
            },
          ],
          createdAt: "2026-09-29T10:00:00.000Z",
          updatedAt: "2026-09-29T10:00:00.000Z",
        },
      ],
    })),
    discoverWorkflowSkillCandidates: vi.fn(async () => ({
      version: 1,
      proposalCount: 0,
      proposals: [],
    })),
    submitSkillCandidate: vi.fn(async (manifest) => ({
      idempotent: false,
      candidate: { id: "candidate_new", currentDigest: "digest-new", manifest },
    })),
    getSkillCandidate: vi.fn(),
    reviseSkillCandidate: vi.fn(),
    validateSkillCandidate: vi.fn(async () => ({ valid: true })),
    dismissSkillCandidate: vi.fn(),
    compileSkillCandidateTest: vi.fn(async () => ({
      compiled: true,
      task: { id: "task_skilltest_1" },
    })),
    runTask: vi.fn(async () => ({ id: "task_skilltest_1", status: "completed" })),
    inspectSkillCandidate: vi.fn(async () => ({
      readiness: { promotable: true, reasons: [] },
    })),
    promoteSkillCandidate: vi.fn(async () => ({ promoted: true })),
    setUserSkillEnabled: vi.fn(),
    activateUserSkillVersion: vi.fn(),
    rollbackUserSkill: vi.fn(),
    uninstallUserSkill: vi.fn(),
    ...overrides,
  });
}

describe("RuntimeSkillManagerPort", () => {
  it("maps Runtime 1.0 catalog without inventing registry state", async () => {
    const port = new RuntimeSkillManagerPort({ client: mockClient() });
    const snapshot = await port.snapshot();

    expect(snapshot.source).toBe("runtime-1.0");
    expect(snapshot.summary.installed).toBe(2);
    expect(snapshot.summary.ready).toBe(1);
    expect(snapshot.summary.needsAttention).toBe(1);
    expect(snapshot.candidates).toEqual([]);
    expect(snapshot.userSkills).toEqual([]);
    expect(snapshot.lifecycle).toEqual({
      registrySupported: false,
      candidatesSupported: false,
      discoverySupported: false,
      librarySupported: false,
      reason: "Requires Runtime 1.x User Skill Registry",
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

  it("feature-detects Registry and Workflow Discovery and reads canonical Runtime state", async () => {
    const client = lifecycleClient();
    const port = new RuntimeSkillManagerPort({ client });
    const snapshot = await port.snapshot();

    expect(snapshot.source).toBe("runtime-1.x");
    expect(snapshot.lifecycle).toMatchObject({
      registrySupported: true,
      candidatesSupported: true,
      discoverySupported: true,
    });
    expect(client.listSkillCandidates).toHaveBeenCalledTimes(1);
    expect(client.listUserSkills).toHaveBeenCalledTimes(1);
    expect(snapshot.summary.candidates).toBe(1);
    expect(snapshot.userSkills).toHaveLength(1);
    expect(snapshot.skills[0]).toMatchObject({
      source: "user",
      enabled: true,
      availability: "ready",
      lifecycle: {
        canEnableDisable: true,
        canRollback: true,
        canUninstall: true,
      },
    });
  });

  it("does not call additive lifecycle RPCs when capability extensions are absent", async () => {
    const listSkillCandidates = vi.fn();
    const listUserSkills = vi.fn();
    const port = new RuntimeSkillManagerPort({
      client: mockClient({ listSkillCandidates, listUserSkills }),
    });

    await port.snapshot();

    expect(listSkillCandidates).not.toHaveBeenCalled();
    expect(listUserSkills).not.toHaveBeenCalled();
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

  it("maps the discovery-review-test-promote flow to Runtime public clients", async () => {
    const client = lifecycleClient();
    const port = new RuntimeSkillManagerPort({ client });
    const manifest = {
      schemaVersion: 1,
      skillAbiVersion: 1,
      id: "user.workflow.report-abcd1234",
      version: "0.1.0",
      title: "Daily report",
      description: "Build report",
      requiredPrimitiveAbi: 1,
      requiredPrimitives: ["fs.write"],
      executionMode: "durable",
      inputs: {},
      contract: {
        riskLevel: "medium",
        idempotent: true,
        sideEffects: ["file_creation"],
        retryPolicy: "automatic",
        requiresVerification: true,
      },
      steps: [],
    };

    await port.discover({ minSuccessfulRuns: 3 });
    await port.submitCandidate(manifest);
    await port.validateCandidate("candidate_new", "digest-new");
    const compiled = await port.compileCandidateTest(
      "candidate_new",
      "digest-new",
      { date: "2026-09-29" },
    );
    await port.runCandidateTest(compiled.task.id);
    await port.inspectCandidate("candidate_new", compiled.task.id);
    await port.promoteCandidate(
      "candidate_new",
      "digest-new",
      compiled.task.id,
      true,
    );

    expect(client.discoverWorkflowSkillCandidates).toHaveBeenCalledWith({
      minSuccessfulRuns: 3,
    });
    expect(client.submitSkillCandidate).toHaveBeenCalledWith(manifest);
    expect(client.validateSkillCandidate).toHaveBeenCalledWith(
      "candidate_new",
      "digest-new",
    );
    expect(client.compileSkillCandidateTest).toHaveBeenCalledWith(
      "candidate_new",
      "digest-new",
      { date: "2026-09-29" },
    );
    expect(client.runTask).toHaveBeenCalledWith("task_skilltest_1", {
      maxWaves: 100,
      timeBudgetMs: 120_000,
      timeoutMs: 130_000,
    });
    expect(client.inspectSkillCandidate).toHaveBeenCalledWith(
      "candidate_new",
      "task_skilltest_1",
    );
    expect(client.promoteSkillCandidate).toHaveBeenCalledWith(
      "candidate_new",
      "digest-new",
      "task_skilltest_1",
      true,
    );
  });

  it("forwards canonical installed User Skill lifecycle operations", async () => {
    const client = lifecycleClient();
    const port = new RuntimeSkillManagerPort({ client });

    await port.setEnabled("user.workflow.report-abcd1234", false);
    await port.activateVersion("user.workflow.report-abcd1234", "0.2.0");
    await port.rollback("user.workflow.report-abcd1234");
    await port.uninstall("user.workflow.report-abcd1234", "0.1.0");

    expect(client.setUserSkillEnabled).toHaveBeenCalledWith(
      "user.workflow.report-abcd1234",
      false,
    );
    expect(client.activateUserSkillVersion).toHaveBeenCalledWith(
      "user.workflow.report-abcd1234",
      "0.2.0",
    );
    expect(client.rollbackUserSkill).toHaveBeenCalledWith(
      "user.workflow.report-abcd1234",
      undefined,
    );
    expect(client.uninstallUserSkill).toHaveBeenCalledWith(
      "user.workflow.report-abcd1234",
      "0.1.0",
    );
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
