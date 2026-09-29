import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentInboxStore } from "../electron/services/agent-inbox-store.mjs";
import {
  assertCandidateMatchesRepairRequest,
  assertRepairSourceRevision,
  manifestDigestForRepair,
  projectSkillRepairContext,
  repairIdempotencyKey,
  repairTransportRequestId,
  requireClaimedSkillRepair,
  sanitizeValidationForAgent,
} from "../mcp/skill-repair.mjs";

const scratch = [];

function makeInbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owl-skill-repair-"));
  scratch.push(dir);
  const inbox = new AgentInboxStore({
    file: path.join(dir, "agent-inbox.json"),
  });
  return { dir, inbox };
}

function createRepairRequest(inbox, overrides = {}) {
  const created = inbox.create({
    type: "skill.repair",
    producer: "runtime",
    priority: "high",
    subject: {
      kind: "skill_candidate",
      id: "candidate_123",
      revision: "1",
    },
    reasonCode: "VALIDATION_FAILED",
    errorCodes: ["USER_SKILL_PRIMITIVE_ABI_UNSUPPORTED"],
    contextRefs: [
      {
        kind: "skill_candidate",
        id: "candidate_123",
        revision: "1",
      },
    ],
    allowedActions: [
      "candidate.inspect",
      "candidate.revise",
      "candidate.validate",
    ],
    requiresUserConfirmation: true,
    correlationId: "proposal_123",
    dedupeKey: "runtime:repair:candidate_123:r1",
    ...overrides,
  });
  return created.request;
}

function baseManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    skillAbiVersion: 1,
    id: "user.example",
    version: "0.1.0",
    title: "Example",
    description: "Example skill",
    requiredPrimitiveAbi: 999,
    requiredPrimitives: ["git.query"],
    executionMode: "durable",
    inputs: {
      cwd: {
        type: "string",
        required: true,
      },
    },
    contract: {
      riskLevel: "low",
      idempotent: true,
      sideEffects: [],
      retryPolicy: "automatic",
      requiresVerification: false,
    },
    steps: [
      {
        id: "status",
        primitive: "git.query",
        op: "status",
        args: {
          cwd: { $input: "cwd" },
        },
      },
    ],
    ...overrides,
  };
}

function candidate({
  revision = 1,
  currentDigest = "digest_r1",
  manifest = baseManifest(),
  validation,
} = {}) {
  return {
    version: 1,
    id: "candidate_123",
    status: "active",
    createdAt: "2026-09-29T20:00:00.000Z",
    updatedAt: "2026-09-29T20:01:00.000Z",
    revision,
    currentDigest,
    revisions: [
      {
        revision: 1,
        digest: "digest_r1",
        createdAt: "2026-09-29T20:00:00.000Z",
        manifest,
      },
      ...(revision >= 2
        ? [
            {
              revision: 2,
              digest: currentDigest,
              createdAt: "2026-09-29T20:01:00.000Z",
              manifest: baseManifest({ requiredPrimitiveAbi: 1 }),
            },
          ]
        : []),
    ],
    validation:
      validation ?? {
        reportVersion: 1,
        candidateId: "candidate_123",
        candidateDigest: currentDigest,
        valid: false,
        targetSkillAbi: 1,
        primitiveAbi: { runtime: 1, required: 999 },
        requiredPrimitives: ["git.query"],
        allowedPrimitives: ["git.query"],
        derivedContract: null,
        effectiveContract: null,
        errors: [
          {
            code: "USER_SKILL_PRIMITIVE_ABI_UNSUPPORTED",
            file: "skill.json",
            path: "requiredPrimitiveAbi",
            message: "Candidate requires a newer Primitive ABI.",
            actual: 999,
            allowed: 1,
          },
        ],
        warnings: [],
        validatedAt: "2026-09-29T20:00:30.000Z",
      },
    tests: [],
    publicEventOutbox: [
      {
        event: {
          eventType: "agent_request.proposed",
          eventId: "must-not-leak",
        },
      },
    ],
  };
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("AgentRequest Skill repair projection", () => {
  it("returns current repair context without Candidate history or Runtime outbox", () => {
    const { inbox } = makeInbox();
    const request = createRepairRequest(inbox);
    const projected = projectSkillRepairContext(request, candidate());

    expect(projected.request).toMatchObject({
      requestId: request.requestId,
      type: "skill.repair",
      producer: "runtime",
    });
    expect(projected.candidate).toMatchObject({
      id: "candidate_123",
      revision: 1,
      currentDigest: "digest_r1",
      manifest: {
        id: "user.example",
        requiredPrimitiveAbi: 999,
      },
    });
    expect(projected.candidate.revisions).toBeUndefined();
    expect(projected.candidate.publicEventOutbox).toBeUndefined();
    expect(JSON.stringify(projected)).not.toContain("must-not-leak");
    expect(projected.privacy.rawManifestExposed).toBe(false);
  });

  it("redacts embedded-secret evidence and secret-bearing execution literals", () => {
    const { inbox } = makeInbox();
    const request = createRepairRequest(inbox, {
      errorCodes: ["USER_SKILL_EMBEDDED_SECRET_BLOCKED"],
    });
    const secretA = "sk-live-supersecret0123456789";
    const secretB = "Bearer abcdefghijklmnopqrstuvwxyz123456";
    const secretC = "github_pat_abcdefghijklmnopqrstuvwxyz123456";
    const manifest = baseManifest({
      inputs: {
        apiToken: {
          type: "string",
          required: false,
          default: secretA,
        },
      },
      steps: [
        {
          id: "call",
          primitive: "git.query",
          op: "status",
          args: {
            Authorization: secretB,
            apiKey: secretC,
            benign: "ordinary-value",
          },
        },
      ],
    });
    const validation = {
      reportVersion: 1,
      candidateId: "candidate_123",
      candidateDigest: "digest_r1",
      valid: false,
      targetSkillAbi: 1,
      primitiveAbi: { runtime: 1, required: 1 },
      requiredPrimitives: ["git.query"],
      allowedPrimitives: ["git.query"],
      derivedContract: null,
      effectiveContract: null,
      errors: [
        {
          code: "USER_SKILL_EMBEDDED_SECRET_BLOCKED",
          file: "skill.json",
          path: "$",
          message: "Embedded credentials blocked.",
          actual: [secretA, secretB, secretC],
        },
      ],
      warnings: [],
      validatedAt: "2026-09-29T20:00:30.000Z",
    };

    const projected = projectSkillRepairContext(
      request,
      candidate({ manifest, validation }),
    );
    const encoded = JSON.stringify(projected);

    expect(encoded).not.toContain(secretA);
    expect(encoded).not.toContain(secretB);
    expect(encoded).not.toContain(secretC);
    expect(encoded).not.toContain("must-not-leak");
    expect(projected.candidate.validation.errors[0].actual).toEqual({
      redacted: true,
      matchCount: 3,
    });
    expect(projected.candidate.manifest.inputs.apiToken.default).toBe(
      "<redacted:secret>",
    );
    expect(projected.candidate.manifest.steps[0].args.Authorization).toBe(
      "<redacted:secret>",
    );
    expect(projected.candidate.manifest.steps[0].args.apiKey).toBe(
      "<redacted:secret>",
    );
    expect(projected.candidate.manifest.steps[0].args.benign).toBe(
      "<redacted:secret>",
    );
    expect(projected.privacy).toMatchObject({
      mode: "secret_blocked_conservative",
      redacted: true,
      rawManifestExposed: false,
    });
  });

  it("preserves non-secret validation evidence needed for ABI repair", () => {
    const report = sanitizeValidationForAgent(candidate().validation);
    expect(report.errors[0]).toMatchObject({
      code: "USER_SKILL_PRIMITIVE_ABI_UNSUPPORTED",
      path: "requiredPrimitiveAbi",
      actual: 999,
      allowed: 1,
    });
  });
});

describe("AgentRequest Skill repair authority binding", () => {
  it("requires the request to be claimed by the same stable logical owner", () => {
    const { inbox } = makeInbox();
    const request = createRepairRequest(inbox);

    expect(() =>
      requireClaimedSkillRepair({
        agentInbox: inbox,
        requestId: request.requestId,
        ownerId: "owl-owner:a",
        ownerStable: true,
        action: "candidate.inspect",
      }),
    ).toThrow("SKILL_REPAIR_CLAIM_REQUIRED");

    inbox.claim(request.requestId, {
      ownerId: "owl-owner:a",
      ownerStable: true,
      leaseSeconds: 600,
    });

    expect(() =>
      requireClaimedSkillRepair({
        agentInbox: inbox,
        requestId: request.requestId,
        ownerId: "owl-owner:b",
        ownerStable: true,
        action: "candidate.inspect",
      }),
    ).toThrow("SKILL_REPAIR_CLAIM_REQUIRED");

    expect(
      requireClaimedSkillRepair({
        agentInbox: inbox,
        requestId: request.requestId,
        ownerId: "owl-owner:a",
        ownerStable: true,
        action: "candidate.inspect",
      }).requestId,
    ).toBe(request.requestId);
  });

  it("requires stable ownership and an explicitly allowed coordination action", () => {
    const { inbox } = makeInbox();
    const request = createRepairRequest(inbox, {
      allowedActions: ["candidate.inspect"],
    });
    inbox.claim(request.requestId, {
      ownerId: "transport:fallback",
      ownerStable: false,
      leaseSeconds: 600,
    });

    expect(() =>
      requireClaimedSkillRepair({
        agentInbox: inbox,
        requestId: request.requestId,
        ownerId: "transport:fallback",
        ownerStable: false,
        action: "candidate.inspect",
      }),
    ).toThrow("SKILL_REPAIR_STABLE_OWNER_REQUIRED");

    const { inbox: secondInbox } = makeInbox();
    const second = createRepairRequest(secondInbox, {
      allowedActions: ["candidate.inspect"],
    });
    secondInbox.claim(second.requestId, {
      ownerId: "owl-owner:stable",
      ownerStable: true,
      leaseSeconds: 600,
    });

    expect(() =>
      requireClaimedSkillRepair({
        agentInbox: secondInbox,
        requestId: second.requestId,
        ownerId: "owl-owner:stable",
        ownerStable: true,
        action: "candidate.revise",
      }),
    ).toThrow("SKILL_REPAIR_ACTION_NOT_ALLOWED");
  });

  it("rejects stale read context but permits immutable source binding for replay", () => {
    const { inbox } = makeInbox();
    const request = createRepairRequest(inbox);
    const advanced = candidate({
      revision: 2,
      currentDigest: "digest_r2",
    });

    expect(() =>
      assertCandidateMatchesRepairRequest(request, advanced),
    ).toThrow("SKILL_REPAIR_REQUEST_STALE");

    expect(
      assertRepairSourceRevision(
        request,
        advanced,
        "digest_r1",
      ),
    ).toMatchObject({
      revision: 1,
      digest: "digest_r1",
    });

    expect(() =>
      assertRepairSourceRevision(
        request,
        advanced,
        "digest_wrong",
      ),
    ).toThrow("SKILL_REPAIR_EXPECTED_DIGEST_MISMATCH");
  });

  it("keeps logical repair idempotency stable while transport attempts remain unique", () => {
    const requestId = "ar_example";
    expect(repairIdempotencyKey(requestId, "candidate-revise")).toBe(
      repairIdempotencyKey(requestId, "candidate-revise"),
    );
    expect(repairIdempotencyKey(requestId, "candidate-revise")).not.toBe(
      repairIdempotencyKey(requestId, "candidate-validate"),
    );

    const first = repairTransportRequestId(
      "owl-owner:stable",
      "candidate-revise",
    );
    const second = repairTransportRequestId(
      "owl-owner:stable",
      "candidate-revise",
    );
    expect(first).not.toBe(second);
    expect(first).toMatch(/^owl-mcp-repair:/);
    expect(second).toMatch(/^owl-mcp-repair:/);
  });

  it("uses stable canonical manifest hashing for repair evidence", () => {
    const left = {
      b: 2,
      a: { z: true, y: "value" },
    };
    const right = {
      a: { y: "value", z: true },
      b: 2,
    };
    expect(manifestDigestForRepair(left)).toBe(
      manifestDigestForRepair(right),
    );
  });
});
