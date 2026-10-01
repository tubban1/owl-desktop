#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";
import { RuntimeSkillManagerPort } from "../electron/services/skill-manager-port.mjs";

const runtimeBaseUrl =
  process.env.OWL_RUNTIME_URL || "http://127.0.0.1:18788";
const repo = process.env.OWL_E2E_REPO || process.cwd();
const suffix =
  process.env.OWL_E2E_SUFFIX ||
  Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
const skillId = `user.e2e_repo_health_${suffix}`;
const runtime = new RuntimeHttpClient({
  baseUrl: runtimeBaseUrl,
  sessionId: `owl-desktop:skill-manager-e2e:${suffix}`,
});
const manager = new RuntimeSkillManagerPort({ client: runtime });

function manifest(version = "0.0.1") {
  return {
    schemaVersion: 1,
    skillAbiVersion: 1,
    id: skillId,
    version,
    title: "Skill Manager live E2E repository health",
    description:
      "Live Desktop Skill Manager verifier using canonical Runtime governance and execution.",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: ["git.query"],
    executionMode: "durable",
    inputs: {
      cwd: {
        type: "string",
        required: true,
        description: "Repository working directory",
      },
    },
    contract: {
      riskLevel: "low",
      idempotent: true,
      sideEffects: [],
      retryPolicy: "automatic",
      requiresVerification: false,
      resources: [],
    },
    steps: [
      {
        id: "status",
        primitive: "git.query",
        op: "status",
        args: { cwd: { $input: "cwd" } },
      },
      {
        id: "log",
        primitive: "git.query",
        op: "log",
        args: { cwd: { $input: "cwd" }, max_count: 3 },
        dependsOn: ["status"],
      },
    ],
    provenance: { origin: "workflow" },
  };
}

let candidate = null;
let promoted = false;
try {
  const before = await manager.snapshot();
  assert.equal(before.lifecycle.registrySupported, true);
  assert.equal(before.lifecycle.candidatesSupported, true);
  assert.equal(before.lifecycle.discoverySupported, true);

  const submitted = await manager.submitCandidate(manifest());
  candidate = submitted.candidate;
  assert.equal(candidate.status, "active");

  const validation = await manager.validateCandidate(
    candidate.id,
    candidate.currentDigest,
  );
  assert.equal(validation.valid, true);

  const compiled = await manager.compileCandidateTest(
    candidate.id,
    candidate.currentDigest,
    { cwd: repo },
  );
  assert.equal(compiled.compiled, true);
  assert.ok(compiled.task?.id);

  const ran = await manager.runCandidateTest(compiled.task.id);
  assert.equal(ran.status, "completed");

  const inspection = await manager.inspectCandidate(
    candidate.id,
    compiled.task.id,
  );
  assert.equal(inspection.readiness.promotable, true);

  const promotion = await manager.promoteCandidate(
    candidate.id,
    candidate.currentDigest,
    compiled.task.id,
    true,
  );
  assert.equal(promotion.promoted, true);
  promoted = true;

  const afterPromotion = await manager.snapshot();
  const installed = afterPromotion.skills.find((skill) => skill.id === skillId);
  assert.ok(installed);
  assert.equal(installed.source, "user");
  assert.equal(installed.availability, "ready");

  const executed = await manager.run(skillId, { cwd: repo });
  const executedTaskId = executed?.result?.id ?? executed?.id;
  assert.ok(executedTaskId);
  const executedTask = await runtime.runTask(executedTaskId, {
    maxWaves: 100,
    timeBudgetMs: 120_000,
    timeoutMs: 130_000,
  });
  assert.equal(executedTask.status, "completed");

  await manager.setEnabled(skillId, false);
  const disabled = await manager.snapshot();
  const disabledSkill = disabled.skills.find((skill) => skill.id === skillId);
  assert.equal(disabledSkill?.availability, "disabled");

  await manager.setEnabled(skillId, true);
  const reenabled = await manager.snapshot();
  const readyAgain = reenabled.skills.find((skill) => skill.id === skillId);
  assert.equal(readyAgain?.availability, "ready");

  const registry = await runtime.getUserSkill(skillId);
  assert.ok(registry?.activeVersion);
  await manager.uninstall(skillId, registry.activeVersion);

  const finalSnapshot = await manager.snapshot();
  assert.equal(
    finalSnapshot.skills.some((skill) => skill.id === skillId),
    false,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtime: runtimeBaseUrl,
        skillId,
        registrySupported: true,
        discoverySupported: true,
        submitValidate: true,
        compileAndRunCandidateTest: true,
        inspectionPromotable: true,
        promote: true,
        executePromotedSkill: true,
        disableEnable: true,
        uninstall: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (candidate && !promoted) {
    await manager
      .dismissCandidate(candidate.id, candidate.currentDigest)
      .catch(() => undefined);
  }
  throw error;
}
