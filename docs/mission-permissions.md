# Agent execution permissions — 2026-10-29

The additional OWL Mission-by-Mission signing and per-process authorization
layer is **retired**. It repeatedly blocked existing Codex and other agents
despite the user already enabling execution in OWL Runtime Settings.

## One authority for normal Agent tools

The connected OWL Runtime uses the user's existing capability settings
(**On / Off / Ask**) for Shell, file writes, delete, Git Push and rollback.
When the user has enabled a capability, agents do **not** need to obtain a
second Mission or per-process signature. No code-defined worktree, thread,
app or agent-specific permission whitelist exists in the live MCP dispatch.

workstream_open only records task context, checkpoints and descriptive
constraints. It does not create or revoke execution rights. Calls such as
start_process, execute_command, write_file and git_push are sent to
the same Runtime policy path regardless of planner/workstream/agent.

The duplicate mission_process_start and mission_codex_resume tools
have been removed. Use the normal start_process tool for Codex and others.

The duplicate Mission Control review card was removed from the Settings
page. The existing Runtime permission switches remain the source of truth.

## Boundaries intentionally unchanged

- Underlying OS filesystem protections and authenticated device/connection
  access still apply.
- OWL Runtime settings still apply: Off is denied, Ask invokes its *own*
  existing approval mechanism, and On allows that capability.
- Separate cloud service authentication, user login and third-party API
  authorization remain intact.
- Existing Mission signatures and audit history may remain in stored
  workstream records for provenance but **are never checked in normal MCP
  execution**. No previously rejected task is silently rerun.
- This change does not automatically start, retry, deploy or delete anything.

## Verification requirements

1. An unsigned workstream with a descriptive scope can use start_process,
   execute_command and write_file when the Runtime policy allows.
2. A Runtime refusal propagates, never overridden by this compatibility fix.
3. The Mission review UI is absent; no task-specific approval required.
4. A manually resumed original Codex session must produce real artifacts;
   process exit 0 alone is not a completion or artistic acceptance.
