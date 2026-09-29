# OWL LAB Product Governance v1

Status: **Normative for integration closure**

OWL LAB is one product family with three long-term technical components and one user-facing cloud product surface.

## Long-term product/component map

```text
OWL LAB
├─ Desktop
│  local product shell / integration host / secure vault / MCP / Cloud bridge
├─ Runtime
│  local execution authority
└─ Cloud
   identity / configuration / device / RemoteCommand / product persistence
   └─ Worker
      user-facing web product for creating, scheduling and reviewing AI workers
```

The current `owl-worker` repository is a migration source. It is not a second long-term Cloud authority.

## Authority boundaries

### OWL LAB Runtime

Owns:

- canonical execution state;
- Task / Process / Schedule;
- Primitive and Skill execution;
- policy / Approval enforcement;
- Observation / Verification;
- execution recovery;
- local User Skill registry;
- execution receipts and replay semantics.

Runtime does not own:

- Cognito login;
- organization membership;
- Cloud DeviceGrant;
- Worker business/account state;
- Desktop UI;
- natural-language product planning.

### OWL LAB Desktop

Owns:

- shipped macOS local product;
- OWL LAB account login UX;
- OS-backed account/device credential storage;
- local Runtime lifecycle;
- OWL MCP lifecycle;
- Cloud bridge;
- local Agent Inbox coordination;
- component compatibility verification;
- local integration E2E.

Desktop does not become execution authority.

### OWL LAB Cloud

Owns:

- Cognito user identity;
- organization/account membership;
- device registration and DeviceGrant;
- configuration and entitlements;
- RemoteCommand persistence/delivery;
- cloud-side telemetry/projections;
- Worker account-grade persistence;
- the hosted Worker web product.

Cloud does not execute local computer work.

### OWL LAB Worker

Worker is a **product surface**, not a separate platform authority.

Long-term destination:

```text
owl-cloud
  / Worker web product
  / account + configuration
  / device control
  / history + projections
```

The `owl-worker` repository may continue temporarily as a migration source until its UI, product models and consumer adapters have been moved into `owl-cloud`.

No new identity, device, command, scheduler, approval or execution authority should be added to `owl-worker`.

## Version policy

Component versions are independent from the customer-facing OWL LAB product version.

### Runtime 1.0

Runtime 1.0 remains frozen on the rc.4 stabilization semantics.

Frozen baseline:

```text
1bea64e1746c2a1fa1482ac92ff327776eeee75d
```

Only release evidence, packaging and release metadata may change before the 1.0 tag. New execution semantics do not go back into Runtime 1.0.

### Runtime 1.x / 1.1 Integration Closure

Runtime 1.x carries integration contracts required for the first complete OWL LAB product.

Current already-implemented 1.x stacks include:

- governed User Skill Registry + Workflow Discovery;
- global durable Runtime public event journal;
- AgentRequest producer.

Next Runtime integration sequence:

```text
R1 Consequential request idempotency / replay
R2 Immutable Execution Revision
R3 Test evidence -> exact revision activation
R4 Same-execution Approval resume
R5 Typed public Task/Run/Observation/Verification DTO
R6 Durable Schedule pause/resume
R7 Broader observability / telemetry projection
R8 Named browser profile registry
```

R1-R6 are Integration Closure. R7-R8 follow without reopening Runtime 1.0.

### OWL LAB Product 1.0

The customer-facing OWL LAB Product 1.0 is allowed to depend on Runtime 1.1.x.

There is no requirement that Desktop, Runtime and Cloud all share the same semantic version number.

The shipped product is defined by an exact compatibility manifest of component versions and commit/artifact fingerprints.

## Canonical truth

```text
short-lived branch = implementation work
PR                 = review / integration unit
main               = canonical development truth
tag/artifact        = release truth
```

Long-lived unmerged branches must not become de facto production architecture.

## Integration mode

Feature exploration may remain parallel.

Contract integration is serialized:

```text
provider contract
-> provider implementation
-> provider conformance PASS
-> merge exact provider SHA
-> consumer integration
-> cross-repo E2E
-> failure/recovery E2E
-> freeze
```

A consumer must not guess a provider contract while the provider is still changing it.

## Current integration train

```text
I0 Runtime 1.0 clean release evidence + tag
I1 Runtime 1.x R1-R6 integration contracts
I2 Desktop consumes exact Runtime contracts
I3 Desktop mandatory OWL LAB login + Device Enrollment
I4 Cloud RemoteCommand -> Desktop -> Runtime -> verified terminal result
I5 Worker moved into Cloud and consumes real Runtime/Cloud projections
I6 duplicate/offline/restart/reconnect destruction tests
I7 signed/notarized production distribution
I8 private beta
```

Every Gate records exact component SHAs.

## PR policy during Integration Closure

Do not mass-merge open PRs.

For each PR choose exactly one:

- merge after its provider/consumer gate passes;
- retarget onto the current canonical dependency;
- split reusable work from obsolete authority;
- close as superseded.

A PR that duplicates another component's authority must not be merged merely because it contains useful code.
