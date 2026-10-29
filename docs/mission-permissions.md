# Mission permissions: configuration, never project-specific code

OWL code enforces signatures, canonical workspace boundaries and exact command
matching. It does **not** contain project names, home directories, user session
IDs, or executable allowlists. No process permission is inferred from prose.

## Two declarative authority sources

1. \`mcp/config/mission-tool-paths.json\` describes existing structured tool
   effects in versioned, code-reviewed data. Path effects remain constrained to
   the user's signed workspace root; unknown tools default to deny.
2. \`mission_contract.execution_permissions\` is planner-proposed and is copied
   verbatim (with schema validation) into the Mission's OS-human-signed scope.
   A process permission is valid **only after** the user reviews the exact
   executable, argument list, cwd, writable roots and sandbox evidence.

A newly added \`execution_permissions\` entry invalidates any old approval
signature. Existing signed workstreams without entries never gain execution
rights when OWL is updated.

### Example (placeholder values, not a live permission)

\`\`\`json
{
  "allowed_repositories": ["sample-worktree"],
  "execution_permissions": [{
    "id": "art-review",
    "executable": "/ABSOLUTE/PATH/TO/CLI",
    "cwd": "/ABSOLUTE/PATH/TO/sample-worktree/output",
    "argv": [
      "--sandbox", "workspace-write",
      "-C", "/ABSOLUTE/PATH/TO/sample-worktree/output",
      "exec", "resume", "--json", "THREAD-ID",
      "Read this approved task and write only new output."
    ],
    "workspace_mode": "write",
    "writable_roots": [
      "/ABSOLUTE/PATH/TO/sample-worktree/output"
    ],
    "sandbox": {
      "type": "tool-native",
      "required_argv_segments": [
        ["--sandbox", "workspace-write"],
        ["-C", "/ABSOLUTE/PATH/TO/sample-worktree/output"]
      ]
    }
  }]
}
\`\`\`

Execution grants are **exact match**, not wildcard patterns. A valid request
calls \`mission_process_start(permission_id)\`; a cached client may call
\`start_process\` only with the exact compiled executable, argv, cwd and mode.

\`tool-native\` means the target CLI claims its **own** command sandbox.
The OWL Runtime does **not** claim that configured \`writable_roots\` are
kernel-enforced. The sandbox behavior must be independently verified before
running an agent with consequential filesystem permissions. Do not substitute
a broad, unverified shell command for a restricted process permission.

\`mission_codex_resume\` remains a compatibility wrapper. It finds a matching
thread and instructionFile in **signed data**; it does not include any
Codex thread ID, repository path or user-home allowlist.

## Non-negotiable checks

- A missing permission, a missing human signature, changed process arguments,
  or a changed executable scope fails closed.
- Absolute, canonical cwd and declared write roots must remain inside the
  signed workspace. Symlinks cannot extend authority.
- No silent auto-approval, permission upgrades, or recurring re-launch.
- A runnable CLI alone is not proof of model execution, artifact acceptance,
  production safety, or successful QA.
