# OWL LAB Desktop — Next Dev Closure V1

Status: active serial execution checklist for the next Desktop build.

## Authoritative inputs

- `FRIEND_BETA_TEST_PLAN_V1.md`: A1-A18, B1-B13, C1-C6 acceptance.
- `FRIEND_BETA_FINDINGS_2026-10-01.md`: evidence-driven P0/P1 order.
- `ONBOARDING_AND_RECOVERY_V1.md`: onboarding and recovery UX.
- `STATE_AND_EVIDENCE_UX_V1.md`: storage/state/evidence contract.
- `INTEGRATION_GATES_V1.md`: cross-repo release gates.
- `LOCAL_E2E_STATUS.md`: prior accepted integration evidence.
- `CROSS_REPO_DEVELOPMENT_PROTOCOL_V1.md`: ownership and contract rules.

## D1 — DEV control path and MCP surface

Target:
```text
ChatGPT → OWL Tunnel DEV → Desktop OWL MCP → Runtime DEV
```

Current implementation:
- `npm run dev:full` orchestration.
- DEV Tunnel binary auto-resolves from `vendor/owl-tunnel/<arch>/tunnel-client-runtime`.
- compatibility tools map to Runtime Primitive ABI rather than a second executor.

Gate:
- Runtime :8788 healthy in development mode.
- Desktop/Vite and MCP :8790 healthy.
- Tunnel reconnects.
- file/write/edit/shell/browser/desktop compatibility calls do not return Tool-not-found.
- connector-visible catalog matches the active MCP registration.

## D2 — Storage Layout V1

Canonical Desktop namespace:
```text
~/Library/Application Support/OWL LAB/
├── desktop/
├── staging/
├── logs/
├── cache/
└── diagnostics/
```

Rules:
- user Allowed folders remain user workspaces such as Desktop/Documents/Downloads and explicit selections;
- the OWL LAB product root is internal application storage, not a normal workspace;
- Runtime-owned staging remains the narrow existing exception;
- Desktop accesses Desktop-owned state directly;
- state/log/diagnostic UI uses dedicated product projections;
- never broaden permission to all of `~/Library`.

Migration:
- copy known legacy Desktop state;
- never delete the source automatically;
- never overwrite an existing canonical destination;
- record a migration report;
- do not move canonical `~/.owl-runtime` in this Desktop change.

Automated gate: `tests/storage-layout.test.mjs`.

## D3 — Source regression

Run as bounded independent phases:
```bash
npm run verify:dev
npm run verify:local-e2e
```

`verify:dev` expands to tests → build/typecheck → diff check → durable-submit verification. `verify:local-e2e` remains separate because it requires the live DEV Runtime/MCP chain.

Exit:
- all existing tests green;
- storage migration tests green;
- compatibility registration verified after MCP restart;
- build green.

## D4 — State & Evidence projection

Desktop product view:
```text
Work: Tasks / Runs / Processes / Approvals / Schedules / Loops / Artifacts
History: Events / Errors / Audit / Recoveries
Skills: Installed / User Skills / Candidates
Advanced: Runtime state / Logs / Replay / Leases / Storage / Diagnostics
```

Runtime remains canonical execution-state owner. Desktop only projects state.

## D5 — Friend-beta P0/P1 closure

Already source-hardened, but requiring next-build/live reconfirmation:
- launchd teardown/bootstrap race;
- exact Runtime identity and wrong-port-owner detection;
- Runtime reconnect authorization;
- Tunnel crash restart;
- MCP disconnect/session recovery;
- durable task reconnect.

Still product-level work:
- first-run onboarding;
- aggregate readiness plus one next action;
- Repair Runtime / Reauthorize / Reconnect ChatGPT;
- move raw transport fields to Advanced;
- managed tunnel provisioning for normal users;
- diagnostics export;
- permission recovery UX;
- clean tester distribution.

## D6 — RC checkpoint

Only after DEV gates are green:
```bash
npm run verify:release-components
npm run verify:packaged-smoke
npm run package:mac:arm64
```

Then execute the owner-assisted next-build tests from `FRIEND_BETA_TEST_PLAN_V1.md`.

## Evidence rule

```text
failure
→ canonical owner
→ regression evidence first where feasible
→ smallest owner-correct fix
→ affected test
→ adjacent regression set
→ update test plan/findings
```

Stay on Desktop + local Runtime integration until D1-D5 close. Resume Cloud product work only when a real Cloud contract dependency is reached.


## Current execution evidence — 2026-10-01

Completed in the current source worktree:

- MCP compatibility registration expanded to file/write/edit/process/git/task/browser/desktop core surfaces.
- `tests/mcp-tool-surface.test.mjs` added to prevent catalog/registration drift.
- Storage Layout V1 implementation and non-destructive migration tests added.
- DEV Tunnel binary auto-resolution added.
- `dev:full` orchestration added.
- `npm test`: **22/22 test files, 105/105 tests PASS**.
- `npm run build`: **PASS**.
- `git diff --check`: **PASS**.

Pending after DEV restart:

- restart through `npm run dev:full`;
- confirm migrated `OWL LAB/desktop` state and migration report;
- confirm Tunnel auto-start uses vendored binary without manual binary path;
- refresh connector/tool discovery and verify the newly registered compatibility tools live;
- run `verify:durable-submit` and `verify:local-e2e` against the refreshed development chain.

Do not treat inability to run a command through a foreground Terminal while the user is interacting with another app as product-test failure.


### P1 product UX implemented in current source worktree

- Top-level green `Connected` no longer means only "Runtime answered". Home now derives one product readiness state across account setup, Runtime execution access, MCP and Tunnel:
  - `SETUP_REQUIRED`
  - `LOCAL_RECOVERY`
  - `AUTHORIZATION_REQUIRED`
  - `CHATGPT_CONNECTION_REQUIRED`
  - `READY`
- Home exposes one primary next action for the current readiness state.
- Raw Runtime/MCP/Tunnel/Cloud endpoint fields moved under a collapsed Advanced section in Settings.
- Tunnel binary is an optional override; DEV and packaged builds resolve the versioned vendored binary automatically.
- Settings now exposes Storage & Evidence V1 status and explicitly states that OWL LAB internal storage is not a user Allowed Folder.
- Migration evidence is version-level immutable: a valid `storage-layout-v1.json` is reused rather than overwritten on later launches.
- Storage migration is initialized only by the Electron single-instance owner.
- `dev:full` now prepares the architecture-specific vendored Tunnel automatically when missing.

These changes require the next Desktop DEV restart + full D3/live regression before acceptance or commit.


### P0 discovered by live dogfood — stale Runtime port ownership

Live `dev:full` dogfood exposed a split-brain startup condition:

- the new Desktop MCP compatibility surface was reachable;
- the Runtime behind it still reported `ALLOW_SHELL=false` and `ALLOW_BROWSER=false`;
- therefore HTTP reachability on :8788 was insufficient proof that Desktop was connected to the Runtime process just launched by `dev:full`.

Fix in current worktree:

- DEV Runtime moved from shared :8788 to isolated :18788 by default;
- `dev:full` fails closed if the DEV port is already occupied;
- Runtime readiness now validates `service=owl-runtime`, `runtime.mode=development`, exact source `codeRoot`, and write/shell/browser/gui capabilities;
- Desktop DEV receives `OWL_RUNTIME_DEV_URL` as an ephemeral override, leaving persistent Settings unchanged;
- Desktop MCP and RuntimeHostSupervisor use the same effective DEV Runtime endpoint;
- Runtime UI projects the effective endpoint and labels DEV override.

Acceptance requires restarting `dev:full` so the parent orchestration and Electron main process load this change, then rerunning source and live gates.


## Live DEV flight evidence — 2026-10-01

The next Desktop build was exercised through the real development chain rather than mocks.

### Runtime integration baseline

The first live restart exposed Runtime branch skew: Desktop was calling the bounded access-lease RPCs while the active Runtime branch did not expose them. To prevent future cross-session branch drift, Desktop DEV now prefers an isolated Runtime worktree:

```text
/Users/wahaha/Documents/Me/Project/cursor/.worktrees/owl-runtime-desktop-integration
branch: local/desktop-integration-dev
baseline: origin/main @ d6320d2
```

The baseline contains:

```text
access.get
access.authorize
access.lock
access.revoke
```

Independent :19788 smoke proved `access.authorize → READY → access.get`.

The live :18788 stack then recovered the real Cloud grant and reported Runtime access `READY`.

### DEV runtime identity and environment

Verified live:

```text
Runtime endpoint: 127.0.0.1:18788
mode: development
codeRoot: isolated Runtime integration worktree
stateRoot: ~/.owl-runtime-dev
Node: v22.23.3 arm64
write: true
shell: true
browser: true
gui: true
```

DEV filesystem access is restricted to:

```text
owl-desktop
isolated owl-runtime integration worktree
Runtime-owned staging
```

The OWL LAB product root is not broadly added to user Allowed folders.

### Storage Layout V1

Migration evidence:

```text
~/Library/Application Support/OWL LAB/desktop/migrations/storage-layout-v1.json
```

Observed:

- copied settings.json;
- copied secrets.json;
- copied cloud-bridge-state.json;
- copied runtime-agent-request-event-bridge.json;
- no migration errors;
- source legacy Desktop root retained;
- canonical destination was not destructively overwritten.

### Desktop source gates

```text
npm run verify:dev
22/22 test files PASS
106/106 tests PASS
build PASS
git diff --check PASS
verify:durable-submit PASS
```

Live `verify:local-e2e`, executed as a detached read-mode process so the Runtime under test is not recursively blocked by its own parent `sys.exec`, passed:

```text
PASS tool discovery
PASS RuntimeClient info
PASS MCP Agent Inbox discovery
PASS MCP → Runtime git.query
PASS deterministic read-only retry
PASS MCP detached task start/status
PASS same logical owner reconnect
```

Do not run the live local-E2E from a blocking `sys.exec` call on the same Runtime. That creates a recursive test topology rather than an external-client topology.

### Runtime shell determinism finding

Live dogfood found that Runtime itself was started with native Node 22 arm64, while `sys.exec node` resolved to Node 23 x64 because `shellOps` used a login shell (`-lc`) and loaded the user's login profile.

Runtime integration fix:

- shell execution now uses controlled non-login `-c`;
- parent Runtime PATH is preserved;
- both inline sys.exec and managed-process paths use the deterministic environment;
- `verify:shell-environment` was added and wired into the Runtime RC-fast gate.

Live proof after hot reload:

```text
sys.exec node = v22.23.3 arm64
Runtime access remained READY
MCP/Tunnel chain remained reachable
```

### Browser restart reconciliation finding

A Runtime hot reload left the OWL-managed Chrome process alive on its persistent profile. The new Runtime had lost its in-memory Playwright connection, so a second Chrome launch against the same profile exited cleanly and the new CDP port never opened.

Runtime integration fix:

- detect the profile-specific SingletonLock PID;
- verify that process belongs to the exact OWL `--user-data-dir`;
- recover the prior `--remote-debugging-port`;
- probe the existing CDP endpoint;
- reconnect Playwright to the surviving browser before attempting a new launch;
- expose `recoveredAfterRuntimeRestart` in browser provider status.

Live proof:

```text
existing managed Chrome PID: 8640
existing CDP: 57964
browser snapshot PASS
provider connected: true
recoveredAfterRuntimeRestart: true
```

Runtime regression proof:

```text
verify:browser-startup-regression PASS
forced first-launch retry PASS
concurrent cold-start sharing PASS
relaunch cleanup PASS
surviving-browser recovery after Runtime restart PASS
typecheck PASS
git diff --check PASS
```

### Remaining live issue

Desktop screenshot succeeds, but background window OCR/UI-tree recovery currently returns macOS LaunchServices timeout `-1712` for the Electron/OWL LAB Desktop window. Treat this as a separate Desktop/helper recovery issue. It must remain visible in Needs Attention until its cause is isolated; it does not invalidate the already-passing Runtime/MCP/file/shell/browser/access gates.


### Helper transport migration and Desktop readiness closure

Live flight exposed a second legacy-path mismatch in the macOS helper layer.

Before the fix:

```text
OWL LAB Helper process → ~/.computer-mcp/helper.sock
legacy Computer MCP Helper → ~/.computer-mcp/helper.sock
DEV Runtime expected → ~/.owl-runtime-dev/helper.sock
```

The Helper therefore existed and had TCC permissions, but Runtime could not reach the expected socket. Runtime then attempted to relaunch an already-running helper through LaunchServices and received macOS error `-1712`.

Runtime integration fix:

- Swift Helper accepts explicit `--socket <path>`;
- Swift Helper supports `OWL_HELPER_SOCKET`, while preserving `COMPUTER_MCP_HELPER_SOCKET` compatibility;
- `OWL_STATE_ROOT/helper.sock` is supported as a fallback;
- Runtime launches the helper executable directly instead of using `/usr/bin/open`;
- Runtime passes the exact Runtime-owned socket path;
- installer defaults new OWL installs to `~/.owl-runtime/helper.sock`;
- installer leaves legacy `~/.computer-mcp/helper.sock` untouched.

Live DEV installation now has independent helpers:

```text
Computer MCP Helper → ~/.computer-mcp/helper.sock
OWL LAB Helper      → ~/.owl-runtime-dev/helper.sock
```

Live verification:

```text
admin.permission(status) PASS
screenCaptureAllowed = true
accessibilityTrusted = true
bundleIdentifier = fan.fde.owl.helper
background Electron window OCR PASS
desktop screenshot PASS
```

The OCR result from the real Electron window also confirmed the product-level top status is **Ready**.

In development the macOS process name is still `Electron`, so background-window operations should target `Electron`. Packaged builds use the branded application identity.


## Human-centered Desktop UX — current implementation

The next Desktop RC now follows `docs/product/HUMAN_CENTERED_DESKTOP_UX_V1.md`.

Implemented in the current source worktree:

- primary navigation reduced to Home / Requests / Activity / Skills / Accounts / Settings;
- Sessions / Runtime / Secrets moved under Advanced;
- Home separates product readiness from current AI work activity;
- activity states derive from canonical Runtime Tasks/Processes/Event reconciliation/Agent Inbox rather than a Desktop execution state machine;
- Working / Waiting / Possibly stuck / Needs attention / Idle user states;
- 3-second quiet Home polling without log spam;
- Wake name and aliases exposed as everyday settings;
- Allowed folders exposed with a native folder picker and explicit remove controls;
- packaged Runtime environment is driven by saved Wake/Allowed-folder settings;
- DEV `dev:full` consumes the same saved user preferences while adding source repos only for development;
- Runtime/MCP/Tunnel/Cloud implementation details remain in collapsed Advanced settings.

Source gate after this implementation: 23/23 test files, 115/115 tests, TypeScript build PASS, Vite production build PASS, git diff check PASS.

### Final canonical DEV UX evidence

Final DEV ran against canonical Runtime main `4e24c19fef12704eb5fe97c1283a3d8c32a4df4c` on isolated port `18788`.

Real OWL self-chain OCR of `OWL LAB — Desktop` verified:

- primary navigation is Home / Requests / Activity / Skills / Accounts / Settings;
- Sessions / Runtime / Secrets are under Advanced;
- Settings visibly exposes Wake name, aliases, Allowed folders, Add folder and Behaviour;
- Home visibly separates PRODUCT READINESS from WHAT OWL IS DOING;
- Ready + no work projects Idle / “OWL is ready for work”;
- a real Runtime-managed `sleep 10` process automatically projected Working / “Background process running” / elapsed runtime / one running process;
- after the process exited with code 0, Home automatically returned to Idle on the 3-second quiet refresh;
- an intentionally generated historical MCP error was initially found to incorrectly override current-work state; this was fixed so historical log errors remain in Activity rather than falsely presenting current work as failed;
- Waiting / Possibly stuck / Needs attention are covered by deterministic `deriveWorkState` tests against Runtime-shaped projections.

### Local E2E timeout diagnosis

An apparent `Runtime request timed out after 10000ms` at MCP `git_status` was reproduced and isolated.

Direct Git completed in roughly 50 ms and normal OWL MCP Git status completed in the low-second range. Raising the timeout to 30 seconds still timed out when the E2E was launched inside `execute_command(workspace_mode=write)`.

Root cause: the outer verification command held the Desktop repository's exclusive Runtime workspace lease while the nested E2E asked the same Runtime to access that repository. The nested request correctly waited for the outer lease, while the outer command waited for the nested request: a verification-orchestration self-deadlock.

The temporary 30-second timeout experiment was fully reverted. Product timeouts remain unchanged.

Re-running the unchanged local E2E without an outer write lease passed:

```text
PASS tool discovery
PASS RuntimeClient info
PASS MCP Agent Inbox discovery
PASS MCP → Runtime git.query → local repository
PASS deterministic read-only retry
PASS MCP detached task start/status (12ms acceptance, revision 9)
PASS same logical owner reconnect
```

This is also evidence that future self-dogfood verifiers must not wrap nested Runtime calls inside a conflicting outer write workspace lease.
