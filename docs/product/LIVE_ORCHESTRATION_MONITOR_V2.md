# OWL LAB Live Orchestration Monitor V2

Status: implementation checkpoint on isolated Desktop worktree.

## Product question

Monitor V1 answers whether the OWL worker fabric is healthy.

Monitor V2 answers how OWL is completing the user's goal:

- what is running;
- who owns or observes the work;
- what is waiting and why;
- which dependencies unlock the next step;
- what verification evidence exists;
- what happened in semantic order.

## Views

### Live

Default human view.

Projects:

- current durable Task progress;
- actor/authority rows;
- AgentRequest coordination;
- Runtime and Desktop projection state;
- Cloud coordination state;
- Skill governance state;
- selected Task inspector.

An actor is named Agent session unless a canonical producer explicitly provides a stronger identity. Desktop must not infer that a Runtime owner is ChatGPT merely because ChatGPT initiated the surrounding conversation.

### Timeline

Timeline is derived from canonical Runtime Task events and AgentRequest lifecycle facts.

It is not a reformatted Activity log.

Examples:

- Task created;
- Run started;
- Step started;
- Approval wait;
- Verification verified / failed / uncertain;
- Step completed;
- Task completed / failed;
- AgentRequest proposed / claimed / resolved.

Activity remains the low-level forensic surface.

### Graph

Graph is derived only from public Task detail:

- steps;
- dependsOn;
- state;
- duration;
- VerificationReceipt state.

The highlighted path is currently the structural longest dependency chain. It is intentionally not described as an estimated completion-time critical path until Runtime exposes duration-aware critical-path semantics.

### System

System preserves Monitor V1 operational projections:

- Runtime / MCP / Tunnel / Cloud / Event / Skill availability;
- Verification counts;
- AgentRequest / Skill / Process / Cloud counts;
- attention queue.

## Authority boundary

Monitor V2 remains a Desktop projection.

It does not:

- own Task state;
- own Process state;
- own Verification;
- own approval decisions;
- recreate Skill lifecycle;
- scrape ChatGPT UI;
- infer private model reasoning.

Runtime public Task detail is fetched through a read-only monitor:task-detail Desktop IPC that calls the existing Runtime public tasks.get contract.

## Current acceptance

- orchestration projection tests: PASS
- Monitor V1 projection tests: PASS
- Desktop full tests: 25 files / 123 tests PASS
- TypeScript / Vite build: PASS
- git diff check: PASS

## Next checkpoint

Group multiple durable Tasks by stable orchestration ownership/correlation so Live can summarize a complete multi-Task goal rather than only the selected Task.
