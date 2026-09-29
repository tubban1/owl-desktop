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

This is a core OWL product feature.

Example:

```text
OWL found a reusable workflow

TEMU 瑞士仓异常订单日报

Observed executions      12
Verified successes       12
Repeated structure       High
Average retries          0.2

Stable steps detected:
1. Open order backend
2. Select date
3. Download file
4. Filter exceptions
5. Generate Excel
6. Verify output

Suggested inputs:
- date
- warehouse
- output directory

Risk: Medium

[Review Candidate]
[Dismiss]
```

Candidate detail should show:

- evidence count;
- evidence Task IDs as safe references;
- recurring Primitive graph;
- parameters inferred as variable;
- constants that will remain fixed;
- proposed side effects;
- proposed risk;
- proposed verification;
- confidence/evidence explanation;
- replay/test status.

## 8. Candidate promotion flow

Default flow:

```text
Repeated verified Tasks
        ↓
Runtime / future distiller creates candidate
        ↓
Desktop shows candidate
        ↓
User reviews
        ↓
Validate / Test Run
        ↓
User confirms
        ↓
Runtime installs immutable Skill version
```

Desktop must not turn one successful task into an automatically activated production Skill.

### Desktop may automate

- surfacing a candidate;
- explaining repeated patterns;
- requesting a candidate draft;
- running dry-run/test validation;
- showing duplicate/compatibility warnings.

### Desktop may not autonomously

- grant new permissions;
- activate a high-risk Skill;
- install arbitrary executable code;
- bypass Runtime validation;
- mark a candidate installed without Runtime receipt.

## 9. Add Skill flow

Provide **+ Add Skill**.

Recommended options:

```text
Add Skill

1. Import Skill Package
2. From Cloud Library         [later]
3. Create from Template       [later]
4. Review Learned Candidate
```

### Import package

Future Runtime-backed flow:

```text
Select package
   ↓
Desktop sends package/manifest to Runtime inspect
   ↓
Runtime returns:
- identity/version
- ABI compatibility
- required capabilities
- risk
- side effects
- verification
- integrity
   ↓
Desktop presents review
   ↓
User confirms
   ↓
Runtime installs
   ↓
Desktop refreshes canonical Registry
```

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

### Phase B — mock now, Runtime 1.x later

Build UI and adapter contracts for:

- user-installed Skills;
- enable/disable;
- install;
- update;
- rollback;
- candidate list;
- candidate promotion;
- uninstall;
- Cloud library.

Use a mock repository behind a typed Desktop port.

Never store mock state in a location that could be mistaken for Runtime canonical Skill Registry.

## 12. Desktop adapter boundary

Do not couple React components directly to current Runtime method details.

Recommended Desktop-side port:

```ts
interface SkillManagerPort {
  listSkills(): Promise<SkillSummary[]>;
  getSkill(skillId: string): Promise<SkillDetail>;

  dryRun(skillId: string, args: Record<string, unknown>): Promise<SkillRunResult>;
  run(skillId: string, args: Record<string, unknown>): Promise<SkillRunResult>;

  inspectPackage?(input: SkillPackageInput): Promise<SkillInspection>;
  install?(inspectionId: string, confirm: boolean): Promise<SkillInstallReceipt>;
  setEnabled?(skillId: string, version: string, enabled: boolean): Promise<void>;
  activateVersion?(skillId: string, version: string): Promise<void>;
  uninstall?(skillId: string, version?: string): Promise<void>;

  listCandidates?(): Promise<SkillCandidate[]>;
  getCandidate?(candidateId: string): Promise<SkillCandidateDetail>;
  testCandidate?(candidateId: string): Promise<CandidateTestResult>;
  promoteCandidate?(candidateId: string, confirm: boolean): Promise<SkillInstallReceipt>;
  dismissCandidate?(candidateId: string): Promise<void>;
}
```

Current implementation can map the first four methods to Runtime 1.0 and leave the optional lifecycle methods unavailable or mock-backed in development.

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
