# OWL LAB Desktop — Human-Centered UX Contract V1

Status: active product contract for the next Desktop RC.

## Product goal

OWL LAB Desktop is a local AI worker control surface for ordinary users, not a Runtime debugging console.

A user opening Desktop should be able to answer, without understanding Runtime, MCP, Tunnel, leases, cursors, or ports:

1. Is OWL ready?
2. What is OWL doing right now?
3. Is work progressing, deliberately waiting, possibly stuck, or failed?
4. Does OWL need something from me?
5. Which files can OWL access?
6. What name do I use to invoke my OWL?
7. Where can I look when something goes wrong?

Runtime remains the canonical execution/state authority. Desktop derives the user-facing projection from Runtime state; it does not create a competing execution state machine.

## Primary navigation

Normal navigation:

- Home
- Requests
- Activity
- Skills
- Accounts
- Settings

Technical surfaces live under **Advanced**:

- Sessions
- Runtime
- Secrets

Technical pages remain available for diagnostics and power users, but they are not the default product language.

## Two distinct top-level signals

### Product readiness

Readiness answers: **Can OWL accept and execute new work?**

States are derived from account, Runtime execution access, MCP, and Tunnel:

- Ready
- Setup required
- Runtime recovery
- Authorization required
- Connect ChatGPT

A readiness error must expose one primary recovery action.

### Work activity

Activity answers: **What is OWL doing now?**

Desktop derives activity from canonical Runtime Tasks, Processes, durable event reconciliation, Agent Inbox, and product readiness. Ordinary historical log errors remain visible in Activity but do not override the current-work state unless they are represented by canonical active-work, readiness, or reconciliation state.

#### Working

Use when:

- a Runtime Task is actively running; or
- a Runtime-managed process is running.

Show:

- human-readable task/process title;
- latest meaningful progress message when available;
- progress percentage when Runtime provides bounded counts;
- elapsed time / age of latest meaningful progress;
- number of running background processes.

#### Waiting

Use when work is intentionally blocked rather than broken:

- waiting for approval;
- paused/blocked by a known dependency;
- AgentRequest queued or claimed.

The UI must explicitly say **Not stuck — waiting deliberately** when that distinction is known.

#### Possibly stuck

Only use when a Runtime Task says it is running but has produced no meaningful progress beyond a bounded threshold.

Current Desktop heuristic:

```text
staleAfter = max(120 seconds, Runtime recommendedPollAfterMs × 8)
```

This is intentionally named *Possibly stuck*, not *Stuck*. Desktop must not claim certainty it does not have.

The signal shows how long it has been since meaningful progress.

#### Needs attention

Use for:

- failed tasks;
- task needs-review state;
- durable event reconciliation gaps;
- readiness failures;
- product readiness failures that prevent work from continuing.

The UI must tell the user what to do next or where to inspect the evidence.

#### Idle

Use when the product is Ready and no task/process/request is active.

Example:

```text
OWL is ready for work
No task or background process is currently running.
```

## Automatic status refresh

Home quietly refreshes Runtime state every 3 seconds.

Quiet refresh:

- must not show a busy spinner;
- must not generate a “Runtime snapshot refreshed” log entry each cycle;
- must not mutate execution state.

Manual refresh remains explicit and visible.

## Everyday Settings

### Wake name

Examples: `OWL`, `Jarvis`.

Canonical Runtime environment:

```text
OWL_WAKE_NAME
OWL_ALIASES
```

Desktop is the user-facing source of this configuration for the local product.

In packaged Desktop, changing it updates managed Runtime configuration and restarts the Runtime service.

In DEV, settings are saved and applied on the next `dev:full` restart.

This is an invocation name for ChatGPT/agents. It is not a claim that always-listening microphone voice activation exists.

### Folders OWL can access

Users manage folders using the native macOS directory picker.

Canonical Runtime policy:

```text
ALLOWED_DIRECTORIES
```

The product clearly separates:

- user workspaces: user-configured Allowed Folders;
- OWL LAB internal product storage: product-managed and not a normal Allowed Folder;
- Runtime-owned staging: narrow internal Runtime exception.

Never solve product-storage access by granting the whole `~/Library` tree.

Packaged Runtime receives exactly the saved user folder list. DEV adds source repos needed for development on top of user folders.

### Behaviour

Everyday settings include:

- Launch at login
- privacy-bounded operational telemetry
- redacted diagnostics

## Advanced Settings

Collapsed by default:

- Runtime endpoint
- auto-connect
- MCP enable/port
- Tunnel enable/autostart/binary override/ID
- Cloud enable/autostart/endpoint/device ID

These remain accessible for development/support, but normal setup should eventually provision transport/account values automatically.

## Acceptance

Before the next RC:

- Home visually exposes readiness and work activity as separate signals.
- A running task shows Working and latest Runtime progress.
- Waiting approval shows Waiting rather than “stuck”.
- stale running task becomes Possibly stuck with elapsed no-progress time.
- failed/reconciliation state becomes Needs attention.
- no work + ready becomes Idle.
- Wake name and aliases are visible and editable.
- Allowed folders are visible, addable through native picker, and removable.
- internal OWL LAB storage is explicitly not presented as an Allowed Folder.
- technical connection configuration is under Advanced.
- canonical Runtime main is used for final DEV verification.
- source tests/build/local E2E pass before packaging.
