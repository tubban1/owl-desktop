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


## Goal worksets

Runtime 1.x now defines explicit additive Task orchestration metadata:

- orchestrationId;
- optional human label;
- optional parentTaskId.

Monitor V2 uses this metadata as the only multi-Task grouping authority.

If the selected Task has an orchestrationId:

- Overall progress aggregates only Tasks with the same orchestrationId;
- Running / Waiting / Completed step counts use the same bounded workset;
- the Live and Graph views show the Goal workset before the selected Task detail;
- Tasks may have different ownerSessionId values and still belong to one Goal.

If the selected Task has no orchestration metadata, Monitor falls back to the selected Task only.

Monitor MUST NOT group Tasks by ownerSessionId as a fallback. A stable Chat or agent session may perform multiple unrelated goals.

The workset view is L0/L1 product structure:

```text
Goal / orchestration
  -> Durable Task
      -> Task Step / Action
          -> Evidence / Verification
```

parentTaskId is presented as descriptive hierarchy only; it is not treated as an execution dependency.

Latest Desktop gate after workset support:

```text
orchestration projection: 5/5 PASS
Monitor projection: 3/3 PASS
Desktop: 25/25 test files, 124/124 tests PASS
TypeScript + Vite build PASS
git diff-check PASS
```
