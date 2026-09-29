# OWL Desktop Skill Manager v1

Status: **Product / implementation baseline**  
Owner: **owl-desktop**  
Execution authority: **owl-runtime**

## 0. Hard boundary

Do **not** modify the current OWL Runtime 1.0 / rc.4 release line for Skill management.

The current Runtime already exposes:

- `skills.catalog`
- `skill.run`
- Skill ABI metadata
- built-in Skill risk / side-effect / verification contracts

Therefore Desktop can already build a real Skill catalog/detail/test-run UI for built-in Skills.

However the current Runtime does **not** yet expose production APIs for:

- installing a new user Skill;
- updating a user Skill;
- enabling/disabling a user Skill;
- version pin/rollback;
- managing a persistent user Skill Registry;
- listing auto-distilled Skill candidates;
- promoting a Skill candidate into an installed executable Skill.

Those are **Runtime 1.x contract requests**, not Runtime 1.0 release blockers.

Desktop must not emulate those execution semantics as production truth.

## 1. Product goal

OWL Control should contain a first-class **Skills** module.

Skills answer:

> What reusable capabilities does this device know how to perform?

The Skill Manager lets the user:

- see installed/built-in Skills;
- understand what each Skill can do;
- inspect required capabilities and risk;
- test-run a Skill;
- install a new user Skill when Runtime 1.x supports it;
- enable/disable Skills;
- update and roll back versions;
- review Skill candidates learned from repeated work;
- see provenance: where a Skill came from and what evidence supports it;
- optionally sync/distribute Skills through OWL Cloud later.

## 2. Ownership

### OWL Runtime owns

- Skill Registry execution truth;
- installed versions;
- Skill ABI compatibility;
- required Primitive checks;
- Skill integrity/digest;
- execution mode;
- risk/side-effect contract;
- Approval enforcement;
- verification semantics;
- Skill execution;
- enable/disable state once the registry exists;
- version activation/rollback semantics;
- Skill candidate validation/promotion semantics in 1.x.

### OWL Desktop owns

- Skills navigation and visual management;
- install/review UI;
- version/update/rollback UI;
- test-run UI;
- candidate review UI;
- risk/capability explanation;
- status presentation;
- Cloud library/sync UX;
- compatibility warnings;
- Contract-shaped mocks while Runtime 1.x surfaces are unavailable.

### OWL Cloud may later own

- optional Skill Library/catalog;
- account/team Skill distribution;
- immutable package storage by digest;
- device sync intent.

Cloud never directly edits Runtime Skill Registry state.

## 3. Information architecture

Add **Skills** as a first-level OWL Control navigation item.

Recommended navigation:

```text
Overview
Sessions
Tasks
Processes
Approvals
Health
Logs
Skills
Vault
Settings
```

Within Skills:

```text
Skills
├─ Overview
├─ Installed
├─ Candidates
└─ Library        [later / Cloud-backed]
```

Do not hide Skills under Settings.

## 4. Skills overview

The top page should answer four questions immediately:

1. What Skills are available?
2. Which are unhealthy/unavailable?
3. Has OWL learned any candidate Skills from my work?
4. Are updates available?

Suggested summary:

```text
Skills

Installed           18
Ready               15
Needs attention      2
Disabled             1
Candidates           3
Updates              1
```

Then show:

- Recently used Skills
- Needs Attention
- New Candidates
- Updates Available

## 5. Installed Skill card

Example:

```text
每日销售日报
user.sales.daily_report
v1.2.0

● Ready

Execution     Durable
Risk          Medium
Source        User
Last run      Today 09:31

Requires
✓ Browser
✓ File Read
✓ File Write

[Run] [Details] [•••]
```

Built-in Skill example:

```text
Runtime Schedule
runtime.schedule
v0.1.0

Source        Built-in
Runtime ABI   Compatible
```

## 6. Skill detail

The detail view should contain:

### Identity

- title
- skill ID
- active version
- source: built-in / user / team / marketplace / distilled
- scope: device / user / workspace / organization
- installedAt
- updatedAt
- digest / integrity status

### Availability

Show a simple state:

- Ready
- Disabled
- Needs Attention
- Incompatible
- Missing Capability
- Missing Permission
- Corrupted / Integrity Failed

Important:

> Installed does not mean currently runnable.

Availability must be derived from Runtime capability/provider/policy facts when available.

### Requirements

- required Primitive ABI
- required Primitives
- required provider capabilities
- ExecutionTarget compatibility
- permission requirements

### Execution contract

- execution mode: inline / durable
- risk level
- idempotent or not
- side effects
- retry policy
- resources
- verification required

### Provenance

For built-in:

```text
Source: OWL Runtime
```

For user-installed:

```text
Source: User package
Digest: ...
Installed by: local user
```

For distilled:

```text
Source: Learned from repeated verified work
Evidence tasks: 14
Verified successes: 13
Candidate created: ...
```

### Actions

Depending on support:

- Run / Test Run
- Dry Run
- Disable / Enable
- Update
- Roll Back
- Uninstall
- View source/evidence

Unsupported Runtime actions must be disabled with an explicit label such as:

> Requires Runtime 1.x Skill Registry

Do not fake success locally.

## 7. Candidate Skill experience

A **Skill Candidate** is not M2 Episodic Memory and not M3 Semantic Memory.

Validated AgentOS behavior shows three distinct durable objects:

```text
Persistent Task
  -> M2 Episodic Memory
  -> optional M3 Semantic Memory

Skill Candidate
  -> validation
  -> test Task
  -> execution evidence
  -> promotion gate
  -> User Skill Registry
```

M3 answers:

> What reusable knowledge/procedure did OWL learn?

A Skill Candidate answers:

> What governed executable capability is proposed for installation?

The two may reference the same evidence, but one must never silently become the other.

Candidate sources may include:

- ChatGPT/user import of an external Skill;
- Desktop package/import flow;
- repeated verified Tasks detected by Worker/Runtime;
- Cloud Library package;
- a manually authored OWL Skill package.

Example Candidate:

```text
Repository quick health check

Source
Repeated verified Tasks

Proposed graph
1. git.query(status)
2. git.query(log)

Test Task
task_xxx

Evidence
2/2 steps succeeded
M2 episode captured
No unresolved state-changing steps

Quality gate
PASS

Privacy gate
PASS

[View Evidence]
[Test Again]
[Send to ChatGPT for Improvement]
[Promote to Skill]
[Dismiss]
```

Candidate detail should show:

- source and provenance;
- candidate revision;
- target Skill ABI / Primitive ABI;
- proposed Primitive graph;
- inferred inputs and outputs;
- proposed risk / side effects / resources / verification;
- validation failures and machine-readable repair report;
- test Task IDs;
- M2 evidence references;
- evidence digest;
- quality/privacy gate results;
- promotion readiness;
- immutable candidate/package digest.

## 8. Candidate lifecycle and promotion

The experimentally validated AgentOS memory flow is:

```text
Primitive graph
  -> runtime.compile_task
  -> Persistent Task
  -> execution
  -> M2 Episodic evidence
  -> optional explicit M3 Semantic promotion
```

Future User Skill lifecycle should extend this model rather than invent a second testing/evidence system:

```text
External Skill / repeated workflow
        |
        v
Skill Candidate
        |
        v
Runtime deterministic validation
        |
   FAIL +----------------------+
        |                      |
        v                      |
machine-readable repair        |
        |                      |
        v                      |
ChatGPT / external AI repair --+
        |
       PASS
        |
        v
compile_test
        |
        v
Persistent Test Task
        |
        v
real execution
        |
        v
M2 Episodic evidence
        |
        v
Skill Promotion Gate
        |
        v
explicit user confirmation
        |
        v
Runtime User Skill Registry
        |
        v
L2 executable Skill
```

Desktop does not modify Skill code semantically. It can:

- submit/import a Candidate;
- display deterministic validation;
- send/copy a repair request for ChatGPT or another AI;
- display test/evidence results;
- request another test;
- request explicit promotion/dismissal.

Desktop must not:

- turn M3 knowledge into executable Skill state by itself;
- treat one successful Task as sufficient promotion evidence;
- grant permissions;
- rewrite arbitrary Skill code with an implicit Desktop LLM;
- bypass Runtime validation/promotion;
- write Registry files directly.

### Repair responsibility

Runtime decides whether a Candidate is valid.

LLM-enabled clients decide how to repair semantic/code problems.

```text
Runtime
  = validate / test / evidence / promotion authority

ChatGPT or AI Worker
  = normalize / rewrite / repair / generalize

Desktop
  = human review and management UX
```

Validation should return a machine-readable repair report so ChatGPT does not have to guess.

## 9. Add Skill flow

Provide **+ Add Skill**.

Ordinary users should not need to know the OWL Skill specification.

Primary paths:

```text
1. Add with ChatGPT
2. Import Skill / package / repository
3. Review Learned Candidate
4. From Cloud Library        [later]
```

### A. ChatGPT path

```text
User gives Skill to ChatGPT
        |
        v
ChatGPT converts/submits Candidate
        |
        v
Runtime validate
        |
   FAIL +---- repair report ----> ChatGPT
        |                           |
        +<------ revised Candidate--+
        |
       PASS
        |
        v
compile/test/evidence
        |
        v
Desktop review
        |
        v
Runtime promote/install
```

ChatGPT may revise the Candidate repeatedly, but only Runtime may declare validation/promotion success.

### B. Desktop import path

```text
Select package / folder / repository
        |
        v
Desktop submits Candidate to Runtime
        |
        v
Runtime validate
        |
    +---+---+
    |       |
   PASS    FAIL
    |       |
    |       +--> [Send to ChatGPT]
    |       +--> [Copy AI Repair Request]
    |       +--> [Upload Revised Candidate]
    |
    v
compile/test/evidence
    |
    v
review + promote
```

Desktop itself does not require or hide an LLM.

### C. Repeated-work path

```text
Repeated successful Tasks
        |
        v
pattern detection
        |
        v
Candidate proposal
        |
        v
ChatGPT/AI generalizes and parameterizes when needed
        |
        v
Runtime validation/test/evidence/promotion
```

### Repair Pack

When validation fails, Desktop should be able to copy/send a self-contained Repair Pack containing:

- candidate ID and revision;
- target Skill ABI;
- target Primitive ABI;
- validation error codes;
- file/path/field references where applicable;
- allowed/required Primitives;
- deterministic constraints;
- package digest;
- behavior-preservation instruction.

No secrets or raw protected execution artifacts should be included.

Desktop must not copy package files directly into Runtime state directories.

## 10. Update / rollback

Skill versions should be immutable.

Example:

```text
Installed
1.2.0  Active

Available
1.3.0
```

Update flow:

```text
Inspect 1.3.0
→ show contract changes
→ show new permissions / side effects
→ dry-run/test
→ confirm
→ Runtime activates 1.3.0
```

If risk/permissions increase, highlight them prominently.

Rollback:

```text
1.3.0
→ Roll back
→ 1.2.0
```

Desktop asks Runtime to activate the old immutable version.

It does not overwrite Skill package contents.

## 11. Current Runtime 1.0 integration

Desktop can implement a useful first phase now.

Current Runtime public surfaces:

```text
skills.catalog
skill.run
capabilities.get
primitives.catalog
health / provider status
```

### Phase A — can ship against Runtime 1.0

Implement:

- first-level Skills navigation;
- installed/built-in list from `skills.catalog`;
- detail view;
- Skill metadata;
- risk/side effects;
- required Primitive ABI;
- required Primitives;
- execution mode;
- memory policy;
- Dry Run using `skill.run { dryRun: true }`;
- Test Run / Run for supported built-ins;
- current capability/provider compatibility;
- clear Built-in source badge.

Do not claim user installation exists yet.

### Phase B — contract-preview UI now, Runtime 1.x later

Build UI and typed adapter contracts for:

- candidate intake;
- validation/repair reports;
- test/evidence review;
- promotion review;
- user-installed Skills;
- enable/disable;
- update;
- rollback;
- uninstall;
- Cloud library.

Until Runtime exposes canonical APIs, keep these controls explicitly unavailable or use static design fixtures only.

Do not persist a mock Candidate/Registry state that could be mistaken for Runtime truth.

## 12. Desktop adapter boundary

Do not couple React components directly to current Runtime method details.

Recommended Desktop-side port:

```ts
interface SkillManagerPort {
  listSkills(): Promise<SkillSummary[]>;
  getSkill(skillId: string): Promise<SkillDetail>;

  dryRun(skillId: string, args: Record<string, unknown>): Promise<SkillRunResult>;
  run(skillId: string, args: Record<string, unknown>): Promise<SkillRunResult>;

  submitCandidate?(input: SkillCandidateInput): Promise<SkillCandidateReceipt>;
  reviseCandidate?(candidateId: string, revision: SkillCandidateRevision): Promise<SkillCandidateReceipt>;
  validateCandidate?(candidateId: string): Promise<SkillValidationReport>;
  compileCandidateTest?(candidateId: string): Promise<CandidateTestTaskReceipt>;
  testCandidate?(candidateId: string): Promise<CandidateTestResult>;
  inspectCandidate?(candidateId: string): Promise<SkillPromotionInspection>;
  promoteCandidate?(candidateId: string, confirm: boolean): Promise<SkillInstallReceipt>;
  dismissCandidate?(candidateId: string): Promise<void>;

  setEnabled?(skillId: string, version: string, enabled: boolean): Promise<void>;
  activateVersion?(skillId: string, version: string): Promise<void>;
  uninstall?(skillId: string, version?: string): Promise<void>;
}
```

Current implementation maps the first four methods to Runtime 1.0. Candidate/Registry lifecycle methods remain unavailable until Runtime 1.x exposes canonical APIs; Desktop may preview their UX with static fixtures, but not with persisted mock truth.

## 13. Suggested UI model

```ts
type SkillAvailability =
  | "ready"
  | "disabled"
  | "needs_attention"
  | "incompatible"
  | "missing_capability"
  | "missing_permission"
  | "integrity_failed";

type SkillSource =
  | "builtin"
  | "user"
  | "distilled"
  | "team"
  | "cloud_library";

type SkillSummary = {
  id: string;
  title: string;
  version: string;
  source: SkillSource;
  availability: SkillAvailability;
  executionMode: "inline" | "durable";
  riskLevel: "low" | "medium" | "high" | "critical";
  enabled: boolean;
  requiredPrimitives: string[];
};
```

This is a Desktop view model, not the canonical Runtime schema.

## 14. Empty states

### No candidates

> OWL 还没有发现稳定的可复用流程。  
> 当你多次成功完成相似任务后，可复用流程会出现在这里供你审核。

### Runtime 1.0 with no user registry

> 当前 Runtime 支持内置 Skill。  
> 用户 Skill 安装和版本管理将在 Runtime 1.x 接入后启用。

This is better than hiding unfinished functionality.

## 15. Cloud Library later

Cloud Library is optional and not required for the first Desktop implementation.

Future flow:

```text
Cloud Skill Library
      ↓ package by digest
Desktop review
      ↓
Runtime inspect
      ↓
Runtime local install
```

Cloud cannot mark a Skill executable on a device without local Runtime validation.

## 16. Security / trust presentation

Desktop must show materially important changes before install/update:

- new Primitive dependency;
- new side effect;
- higher risk level;
- newly non-idempotent behavior;
- new required permission;
- verification removed/weakened;
- source/provenance change;
- integrity mismatch.

High/critical-risk install or activation should require explicit confirmation and may additionally require Runtime Approval policy.

## 17. Telemetry

Desktop may emit privacy-safe product telemetry such as:

- Skill Manager opened;
- install initiated/completed/failed;
- candidate viewed/dismissed/promoted;
- update/rollback outcome.

Do not upload:

- Skill input values;
- user task contents;
- raw package secrets;
- raw procedure memory;
- command/file/message contents.

Execution outcome truth still comes from Runtime.

## 18. Acceptance criteria for Desktop v1 UI

Desktop Skill Manager Phase A is acceptable when:

1. Skills is a first-level Control navigation item;
2. list is backed by Runtime `skills.catalog`;
3. detail shows version/ABI/primitives/execution/risk/side effects;
4. Dry Run is backed by Runtime `skill.run dryRun=true`;
5. actual Run uses Runtime and surfaces Approval/errors honestly;
6. UI never writes Runtime state files;
7. unsupported install/update/candidate actions are explicit, not faked;
8. React components depend on `SkillManagerPort`, not Runtime internals;
9. candidate/install/update UI can be developed against mocks without becoming execution truth.

## 19. Runtime 1.x dependency

The following are required later from Runtime and are tracked as a contract request:

- persistent Skill Registry;
- inspect package;
- install immutable version;
- list versions;
- enable/disable;
- activate/rollback;
- uninstall;
- integrity/provenance status;
- Skill Candidate list/detail/test/promote/dismiss;
- capability availability projection for installed Skill versions.

This is explicitly:

> **NOT an OWL Runtime 1.0 blocker.**

Desktop should proceed in parallel.
