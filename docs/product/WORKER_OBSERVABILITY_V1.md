# OWL LAB Worker Observability V1

Status: implemented and live-verified in Desktop DEV.

## Goal

Monitor answers a different question from Home.

Home answers:

- Can OWL work?
- What is OWL doing right now?
- Does the user need to act?

Monitor answers:

- Where is work flowing through the worker fabric?
- Which lifecycle is accumulating pressure?
- Which durable signals require intervention?
- Are AgentRequest and Skill governance actually moving through their canonical state machines?
- Which subsystem produced the recent operational signal?

Monitor is a projection. It never becomes execution authority.

## Canonical owners

- Runtime owns Tasks, Processes, Verification, Skill Candidate governance, User Skill Registry and durable public events.
- Desktop owns Agent Inbox coordination state and presentation.
- Cloud owns account/device control-plane delivery.
- MCP/Tunnel expose transport; they are not Task truth.

## Current projections

### Execution topology

The first-order system chain exposes:

```text
Runtime
→ MCP
→ Tunnel
→ Cloud
→ Runtime durable Events
→ Skill Registry
```

Each node is projected as healthy, attention or offline from its canonical owner.

The topology is deliberately not a workflow editor. It is a health/availability relationship view.

### Live workload

Desktop keeps a bounded in-memory rolling sample while Monitor is visible.

Current series:

- open AgentRequests;
- active durable Tasks;
- running managed Processes;
- attention signal count.

The series comes from quiet Runtime/Desktop polling. It does not fabricate historical data before the Monitor page was opened.

### AgentRequest lifecycle

Projected states:

- pending;
- claimed;
- completed;
- cancelled;
- pending requests requiring confirmation;
- high/urgent open requests.

### Durable Task lifecycle

Projected from Runtime Task summaries:

- active;
- completed;
- failed;
- needs review;
- waiting approval;
- total/succeeded/running step counts.

### Skill lifecycle

Projected from `RuntimeSkillManagerPort`:

- Runtime catalog count;
- ready / disabled / needs-attention skills;
- active Candidate count;
- deterministically invalid active Candidates;
- active User Skill Registry versions;
- registry/discovery extension availability.

### Verification and policy

Runtime public Task summaries expose a bounded `verificationCounts` aggregate:

- required;
- receipts;
- verified;
- failed;
- uncertain;
- missing.

Monitor renders that aggregate directly as the historical Verification distribution across retained Tasks. Receipt evidence and internal Runtime paths remain behind the Runtime authority boundary.

Current intervention gates remain separate from the historical distribution:

- Tasks in needs-review;
- Tasks waiting approval;
- Cloud commands with uncertain completion;
- invalid active Skill Candidates.

This separation prevents historical Verification statistics from being confused with current worker health.

### Activity sources

Monitor summarizes the bounded Desktop activity stream by source and severity.

Historical warning/error events remain observability data. They do not, by themselves, make the current worker state Needs Attention.

### Recent durable work

Recent Runtime Tasks show:

- canonical status;
- latest meaningful message;
- bounded step progress when available;
- last update time.

## AgentRequest product-live acceptance

The current product path has been verified through the real DEV stack:

```text
Skill Candidate validation failure
→ Runtime agent_request.proposed durable public event
→ Desktop Runtime event bridge
→ canonical local Agent Inbox
→ current live Desktop MCP :8790
→ list
→ claim
→ release
→ reclaim
→ complete
```

A second live flow verified:

```text
pending AgentRequest
→ Skill Candidate repaired
→ Runtime agent_request.withdrawn
→ Desktop reconciliation
→ matching pending request cancelled
```

A completed coordination record is not silently rewritten as cancelled by a later withdrawal.

Permanent verifier:

```text
npm run verify:agent-request-product-live
```

## Skill Manager product-live acceptance

The actual Desktop `RuntimeSkillManagerPort` has been verified against the live canonical Runtime:

```text
snapshot / capability discovery
→ submit Candidate
→ deterministic validate
→ compile Candidate test
→ run normal durable test Task
→ inspect evidence / promotability
→ explicit promote
→ canonical User Skill Registry
→ execute promoted User Skill
→ disable
→ re-enable
→ uninstall
```

Permanent verifier:

```text
npm run verify:skill-manager-product-live
```

This complements, rather than replaces, the existing Runtime-direct workflow/registry verifiers.

## Current acceptance evidence

Latest closure:

```text
24/24 Desktop test files PASS
119/119 tests PASS
TypeScript + Vite production build PASS
durable submit/replay PASS
AgentRequest product-live PASS
Skill Manager product-live PASS
local MCP E2E PASS
same logical owner reconnect PASS
```

Live OCR of the running Electron Desktop confirmed that Monitor is rendering retained real data from the product-live tests, including AgentRequest completion/cancellation and recent Skill Manager durable Tasks.

## Next serialized gap

The next 1.x work item is **Verification Coverage**, not another observability rewrite.

Order after that:

1. Multi-device product UX + capability-aware routing
2. Rich Document Provider
3. Search Provider V2
4. Process Stream / Terminal UX
5. Memory Intelligence

These tracks should remain serial unless a contract boundary is already frozen and independently testable.
