#!/usr/bin/env node
import { RuntimeHttpClient } from "../electron/runtime-http-client.mjs";

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(message + suffix);
  }
}

const baseUrl =
  process.env.OWL_RUNTIME_URL?.trim() || "http://127.0.0.1:8788";
const fixtureRepo = process.env.OWL_RUNTIME_FIXTURE_REPO?.trim();
const token = process.env.OWL_RUNTIME_API_TOKEN?.trim() || undefined;

assert(
  fixtureRepo,
  "OWL_RUNTIME_FIXTURE_REPO is required for the live User Skill integration gate.",
);

const client = new RuntimeHttpClient({
  baseUrl,
  sessionId: "owl-desktop:skill-discovery-live-e2e",
  token,
});

const label = "Desktop CR-DESKTOP-009 repeated repository workflow";

function taskSteps(runIndex) {
  return [
    {
      id: "status",
      primitive: "git.query",
      op: "status",
      args: { cwd: fixtureRepo },
    },
    {
      id: "log",
      primitive: "git.query",
      op: "log",
      args: {
        cwd: fixtureRepo,
        max_count: runIndex + 2,
      },
      depends_on: ["status"],
    },
  ];
}

function testInputsFor(manifest) {
  return Object.fromEntries(
    Object.entries(manifest.inputs ?? {}).map(([name, spec]) => {
      if (spec.default !== undefined) return [name, spec.default];
      if (spec.type === "number") return [name, 5];
      if (spec.type === "boolean") return [name, true];
      return [name, "desktop-e2e"];
    }),
  );
}

const info = await client.info();
assert(info.apiVersion === "0.1", "Unexpected Runtime API version.", info);
console.log(
  `PASS Runtime HTTP reachable (${info.runtimeVersion}, API ${info.apiVersion})`,
);

const capabilities = await client.capabilities("user skill workflow discovery");
assert(
  Number(capabilities?.extensions?.userSkillRegistry?.version ?? 0) >= 1,
  "Runtime does not expose userSkillRegistry v1.",
  capabilities?.extensions,
);
assert(
  Number(capabilities?.extensions?.workflowSkillDiscovery?.version ?? 0) >= 1,
  "Runtime does not expose workflowSkillDiscovery v1.",
  capabilities?.extensions,
);
console.log("PASS Runtime 1.x Skill extensions feature-detected");

for (let index = 1; index <= 3; index += 1) {
  const compiled = await client.runSkill({
    skill: "runtime.compile_task",
    args: {
      label,
      steps: taskSteps(index),
      max_concurrency: 2,
      fail_fast: true,
    },
    dryRun: false,
  });

  const taskId = compiled?.result?.id ?? compiled?.id;
  assert(taskId, `runtime.compile_task did not return a task id for run ${index}.`, compiled);

  const ran = await client.runTask(taskId, {
    maxConcurrency: 2,
    failFast: true,
    maxWaves: 20,
    timeBudgetMs: 30_000,
    timeoutMs: 45_000,
  });
  assert(
    ran?.status === "completed",
    `Repeated fixture task ${index} did not complete.`,
    ran,
  );
}
console.log("PASS three repeated verified Runtime Tasks completed");

const discovery = await client.discoverWorkflowSkillCandidates({
  minSuccessfulRuns: 3,
  scanLimit: 100,
  limit: 20,
  includeBlocked: true,
});

const proposal = discovery?.proposals?.find(
  (item) => item?.manifest?.title === label,
);
assert(proposal, "Desktop could not discover the repeated workflow.", discovery);
assert(proposal.readyForSubmit === true, "Discovered proposal is not submit-ready.", proposal);
assert(proposal.validation?.valid === true, "Discovery validation preview failed.", proposal.validation);
assert(proposal.governance?.state === "new", "Fresh workflow proposal is not governance=new.", proposal.governance);
assert(proposal.support?.successfulRuns >= 3, "Proposal does not contain three supporting runs.", proposal.support);
console.log("PASS WorkflowDiscoveryRuntimeClient proposal review");

const submitted = await client.submitSkillCandidate(proposal.manifest);
const candidate = submitted?.candidate;
assert(candidate?.id, "Candidate submission returned no canonical candidate id.", submitted);
assert(candidate.status === "active", "Submitted Candidate is not active.", candidate);
assert(
  candidate.currentDigest === proposal.manifestDigest,
  "Candidate digest does not match reviewed proposal digest.",
  {
    candidateDigest: candidate.currentDigest,
    proposalDigest: proposal.manifestDigest,
  },
);
console.log("PASS explicit Create Candidate");

const validation = await client.validateSkillCandidate(
  candidate.id,
  candidate.currentDigest,
);
assert(validation?.valid === true, "Candidate validation failed.", validation);
assert(
  validation.candidateDigest === candidate.currentDigest,
  "Validation report is not bound to current Candidate digest.",
  validation,
);
console.log("PASS digest-bound Runtime validation");

const inputs = testInputsFor(proposal.manifest);
const compiledTest = await client.compileSkillCandidateTest(
  candidate.id,
  candidate.currentDigest,
  inputs,
);
assert(compiledTest?.compiled === true, "Candidate test did not compile.", compiledTest);
const testTaskId = compiledTest?.task?.id;
assert(testTaskId, "Candidate test compile returned no Persistent Task id.", compiledTest);
console.log("PASS Candidate compiled to normal Persistent Task");

const testRun = await client.runTask(testTaskId, {
  maxConcurrency: 2,
  failFast: true,
  maxWaves: 20,
  timeBudgetMs: 30_000,
  timeoutMs: 45_000,
});
assert(testRun?.status === "completed", "Candidate test Task did not complete.", testRun);
console.log("PASS Candidate Persistent Test Task completed");

const inspection = await client.inspectSkillCandidate(
  candidate.id,
  testTaskId,
);
assert(
  inspection?.readiness?.promotable === true,
  "Runtime inspection did not mark Candidate promotable.",
  inspection?.readiness,
);
assert(inspection?.test?.m2?.evidenceDigest, "Promotion inspection has no M2 evidence digest.", inspection?.test);
console.log("PASS M2 / verification / quality / privacy promotion inspection");

const promoted = await client.promoteSkillCandidate(
  candidate.id,
  candidate.currentDigest,
  testTaskId,
  true,
);
assert(promoted?.promoted === true, "Runtime did not promote Candidate.", promoted);
assert(
  promoted?.receipt?.candidateDigest === candidate.currentDigest,
  "Promotion receipt is not bound to tested Candidate digest.",
  promoted?.receipt,
);
console.log("PASS explicit digest-bound promotion");

const catalog = await client.skillCatalog();
const installed = Array.isArray(catalog)
  ? catalog.find((skill) => skill?.id === proposal.manifest.id)
  : null;
assert(installed, "Promoted User Skill did not appear in skills.catalog.", catalog);
assert(installed.source === "user", "Promoted catalog entry is not source=user.", installed);
assert(installed.availability === "ready", "Promoted User Skill is not ready.", installed);
console.log("PASS promoted User Skill appears in canonical catalog");

const dryRun = await client.runSkill({
  skill: proposal.manifest.id,
  args: inputs,
  dryRun: true,
});
const dryRunResult = dryRun?.result ?? dryRun;
assert(dryRunResult?.dryRun === true, "Promoted User Skill dry-run failed.", dryRun);
assert(dryRunResult?.source === "user", "Dry-run did not use Runtime User Skill route.", dryRun);
console.log("PASS promoted User Skill dry-run");

await client.setUserSkillEnabled(proposal.manifest.id, false);
let registries = await client.listUserSkills();
let registry = registries?.skills?.find(
  (skill) => skill?.skillId === proposal.manifest.id,
);
assert(registry?.enabled === false, "Runtime Registry did not persist disable.", registry);

await client.setUserSkillEnabled(proposal.manifest.id, true);
registries = await client.listUserSkills();
registry = registries?.skills?.find(
  (skill) => skill?.skillId === proposal.manifest.id,
);
assert(registry?.enabled === true, "Runtime Registry did not persist re-enable.", registry);
assert(
  registry?.activeVersion === proposal.manifest.version,
  "Runtime Registry active version changed unexpectedly.",
  registry,
);
console.log("PASS installed User Skill enable/disable lifecycle");

const afterPromotion = await client.discoverWorkflowSkillCandidates({
  minSuccessfulRuns: 3,
  scanLimit: 100,
  limit: 20,
});
const installedProposal = afterPromotion?.proposals?.find(
  (item) => item?.proposalId === proposal.proposalId,
);
assert(
  installedProposal?.governance?.state === "installed",
  "Discovery did not reconcile promoted workflow to governance=installed.",
  installedProposal?.governance,
);
assert(
  installedProposal?.readyForSubmit === false,
  "Installed workflow incorrectly became submit-ready again.",
  installedProposal,
);
console.log("PASS discovery reconciles installed governance");

console.log(
  JSON.stringify(
    {
      ok: true,
      flow: [
        "repeated_tasks",
        "discover",
        "review",
        "create_candidate",
        "validate",
        "compile_test",
        "run_test",
        "inspect",
        "promote",
        "catalog",
        "dry_run",
        "enable_disable",
      ],
      candidateId: candidate.id,
      candidateDigest: candidate.currentDigest,
      testTaskId,
      skillId: proposal.manifest.id,
      skillVersion: proposal.manifest.version,
      proposalId: proposal.proposalId,
    },
    null,
    2,
  ),
);
