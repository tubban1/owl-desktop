# Skill Manager implementation status

Status: **Phase B product flow implemented on Desktop feature branch**  
Base Runtime compatibility: **1.0.0-rc.4 / API 0.1**  
Optional lifecycle extensions: **User Skill Registry v1 + Workflow Skill Discovery v1**

## Phase A — Built-in Skill management

Implemented and retained:

- first-level **Skills** navigation;
- `SkillManagerPort` renderer boundary;
- Desktop main-process Runtime adapter;
- real `skills.catalog` integration;
- real `primitives.catalog` integration;
- real `capabilities.get` integration;
- real `skill.run { dryRun: true }`;
- real `skill.run` execution;
- built-in Skill detail:
  - version;
  - Primitive ABI;
  - required Primitives;
  - execution mode;
  - memory policy;
  - risk;
  - side effects;
  - idempotency;
  - retry policy;
  - verification;
  - resources;
  - input contract;
- Provider status presentation;
- explicit Runtime authority messaging;
- side-effect confirmation before Desktop submits a real Run;
- Runtime Approval/errors pass through unchanged.

## Phase B — Repeated work to governed User Skill

Desktop now consumes the additive Runtime interfaces:

~~~text
WorkflowDiscoveryRuntimeClient
UserSkillRuntimeClient
~~~

through the public HTTP RPC boundary.

### Product flow

~~~text
Verified Runtime Tasks / M2
        ↓
Discover
        ↓
Review proposal
  - supporting runs
  - evidence used
  - inferred inputs
  - variable paths
  - validation preview
  - governance state
  - manifest/provenance
        ↓
Create Candidate
        ↓
Validate
        ↓
Compile Test
        ↓
normal Persistent Task
        ↓
Run Test
        ↓
Inspect
  - Task completion
  - verification
  - M2 evidence
  - quality gate
  - privacy gate
        ↓
Promote(confirm=true)
        ↓
canonical Runtime User Skill Registry
~~~

Discovery remains read-only. The first write boundary is explicit Candidate submission.

## Runtime feature detection

Desktop does not assume every Runtime compatible with API 0.1 implements the 1.x extensions.

It reads:

~~~text
capabilities.extensions.userSkillRegistry.version
capabilities.extensions.workflowSkillDiscovery.version
~~~

If the extensions are absent:

- built-in Skill catalog/run UX continues to work;
- Discover explicitly shows that Workflow Discovery is unavailable;
- Candidates explicitly shows that canonical Runtime Registry support is required;
- Desktop does not create a local executable Candidate Store or User Skill Registry.

## Runtime public RPCs consumed

### Discovery

~~~text
skill-candidates.discover-workflows
~~~

### Candidate lifecycle

~~~text
skill-candidates.submit
skill-candidates.get
skill-candidates.list
skill-candidates.revise
skill-candidates.validate
skill-candidates.dismiss
skill-candidates.compile-test
skill-candidates.inspect
skill-candidates.promote
~~~

### Test execution

There is intentionally no Desktop test executor.

~~~text
skill-candidates.compile-test
        ↓
Runtime Persistent Task id
        ↓
tasks.run
        ↓
skill-candidates.inspect
~~~

### Installed User Skill lifecycle

~~~text
user-skills.list
user-skills.get
user-skills.enable
user-skills.disable
user-skills.activate-version
user-skills.rollback
user-skills.uninstall
~~~

The Installed view exposes enable/disable, version activation, rollback and uninstall only for canonical Runtime User Skills.

## Digest/evidence safety

Desktop preserves Runtime's digest-bound lifecycle.

Candidate mutations use the exact current `candidateDigest`.

Promotion requires:

- exact Candidate digest;
- exact bound Test Task id;
- Runtime validation;
- completed Persistent Test Task;
- M2 evidence;
- Runtime quality/privacy gates;
- resolved verification;
- explicit confirmation.

Desktop does not infer or override promotion readiness.

## Workflow discovery governance

Discovery proposals expose Runtime annotations:

~~~text
new
dismissed
candidate_exists
installed
~~~

Desktop uses those states to prevent duplicate Candidate creation.

If Runtime reports `evidenceRefreshAvailable=true`, Desktop surfaces the refresh but does not auto-revise an existing Candidate.

Candidate revision remains an explicit Runtime lifecycle action.

## Relationship to Agent Inbox

Agent Inbox remains separate:

~~~text
AgentRequest
= reasoning/repair coordination

Skill Candidate
= canonical Runtime executable-capability draft
~~~

ChatGPT or an AI Worker may later use machine-readable Candidate validation errors to revise a Candidate.

They may not mark validation PASS or bypass test/promotion gates.

## Compatibility and authority

~~~text
OWL Desktop
= review / management UX
= public Runtime client consumer

OWL Runtime
= Candidate Store
= User Skill Registry
= validation truth
= test Task truth
= M2 evidence truth
= promotion truth
= execution authority
~~~

Desktop never writes Runtime state files.

## Test coverage

The Desktop unit suite covers:

- Runtime 1.0 fallback without lifecycle extensions;
- feature detection of User Skill Registry and Workflow Discovery;
- canonical Candidate/Registry reads;
- built-in and User Skill catalog normalization;
- discovery forwarding;
- Candidate submit/validate/compile-test/inspect/promote forwarding;
- test execution through normal `tasks.run`;
- installed User Skill enable/disable/version/rollback/uninstall forwarding;
- Runtime HTTP RPC mapping;
- transport timeout kept out of Runtime Task request payload.

The repository now also has a minimal PR CI gate:

~~~text
npm ci
npm test
npm run build
npm run verify:agent-inbox-e2e
~~~

## Remaining live evidence

Before merging Phase B, run against an actual Runtime build that exposes both 1.x extensions:

~~~text
3+ repeated verified Tasks
→ discover proposal
→ Create Candidate
→ Validate
→ Compile Test
→ Run Test
→ Inspect promotable
→ Promote
→ User Skill appears in skills.catalog
→ Dry Run promoted Skill
→ disable/enable
→ rollback/version management where applicable
~~~

This is the final product-level acceptance for CR-DESKTOP-009.
