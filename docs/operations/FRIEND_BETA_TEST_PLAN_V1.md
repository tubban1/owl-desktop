# OWL LAB Desktop — Friend Beta Test Plan V1

Status: **execute before producing the next friend-beta artifact**

## Test philosophy

Testing is split by what can be proven automatically and what requires a human because macOS security prompts, perceived clarity, browser login, real ChatGPT connection and reboot behavior are product experiences, not just API assertions.

Every test records purpose, precondition, procedure, expected result, actual result, evidence, pass/fail and follow-up.

## A. Tests ChatGPT/automation can execute

| ID | Test | Purpose | Expected result |
| --- | --- | --- | --- |
| A1 | Runtime identity | Ensure Desktop talks to packaged Runtime, never stale dev service | mode=production, stateRoot=~/.owl-runtime, expected release identity/code root |
| A2 | Runtime access state | Verify execution authorization is canonical | Cloud run grant projects to Runtime READY; expired/revoked grants fail closed |
| A3 | Allowed-folder read/write | Prove safe useful default filesystem capability | create/read/update harmless files in Desktop/Documents/Downloads with verification evidence |
| A4 | Out-of-scope filesystem denial | Verify path policy | path outside allowed roots is rejected |
| A5 | Delete default denial | Verify destructive default | delete is rejected while ALLOW_DELETE=false |
| A6 | Shell default denial | Verify privileged default | sys.exec/shell action is rejected while ALLOW_SHELL=false |
| A7 | Primitive observation/verification | Prove Runtime owns execution evidence | state-changing primitive returns observation + verification |
| A8 | No old computer-mcp dependency | Prove installed stack is standalone | OWL MCP still works after :8789/:8791 stop |
| A9 | Runtime restart + reauthorization | Prove recovery without re-login | Runtime reconnects and returns READY automatically with valid Cloud session |
| A10 | launchd repeated restart stress | Detect teardown/bootstrap race | repeated restarts produce zero launchctl error-5 failures |
| A11 | Wrong-port-owner detection | Prevent stale dev Runtime false-positive | foreign/dev Runtime on :8788 is rejected with actionable conflict |
| A12 | Cloud contract route test | Catch Desktop/Cloud API drift | every Desktop route exists in deployed contract; no NOT_FOUND loop |
| A13 | Cloud reconnect/backoff | Verify degraded recovery | transient failures deduplicate, back off and recover |
| A14 | Tunnel lifecycle | Verify Desktop owns transport | credential starts/stops/reconnects tunnel and targets :8790 |
| A15 | Packaged component verification | Guard build contents | exact Runtime/Host/Helper/Tunnel versions and architectures match manifest |
| A16 | Packaged smoke arm64/x64 | Verify generated payload | both architectures contain expected immutable components |
| A17 | Durable task interruption/recovery | Validate long-running product value | task survives MCP/chat reconnect and resumes from canonical Runtime state |
| A18 | Diagnostics export redaction | Verify supportability/privacy | bundle contains evidence but no raw secrets/tokens |

## B. Tests requiring owner participation

| ID | Test | Purpose | Your action | Expected result |
| --- | --- | --- | --- | --- |
| B1 | First-run comprehension | Measure whether setup is self-explanatory | Install without developer guidance and narrate what each screen means | Always know next action without Terminal/docs |
| B2 | Cognito sign-up/login | Validate browser handoff | Create/sign in with a fresh test account | browser returns to Desktop and setup continues automatically |
| B3 | Gatekeeper unsigned-beta flow | Validate private beta instructions | Open unsigned DMG normally | warning recoverable without disabling Gatekeeper globally |
| B4 | Accessibility permission | Validate Helper identity | approve macOS prompt | clicks/typing work after one clear flow |
| B5 | Screen Recording permission | Validate perception permission | approve macOS prompt | screenshots/visual actions work |
| B6 | Quit/reopen Desktop | Validate daily lifecycle | Cmd+Q, reopen | Runtime reconnects, account remains signed in, READY returns automatically |
| B7 | Mac logout/login | Validate Launch at Login | log out/in | Desktop/Runtime recover without Terminal |
| B8 | Full reboot | Validate launchd and secure persistence | reboot Mac | Runtime starts, account resumes, READY returns, tunnel reconnects |
| B9 | Network offline/online | Validate local-first behavior | disable/enable network | local Runtime stays usable within lease; Cloud/tunnel recover |
| B10 | Permission denial UX | Validate recovery messaging | deny one permission once | product explains impact and offers one repair action |
| B11 | Connect ChatGPT | Validate onboarding handoff | connect ChatGPT once | target build requires no Tunnel ID/API key/port entry |
| B12 | Uninstall/reinstall | Validate lifecycle cleanup | uninstall and reinstall | no orphaned broken services; state handling explicit |
| B13 | User-perceived logs | Validate support UX | trigger one harmless error | message states what failed, impact and next action |

## C. Tests requiring friend participation

Use at least one Mac that has never had computer-mcp, owl-runtime or OWL LAB installed. Prefer one moderately technical and one non-technical Apple Silicon tester; add Intel if available.

| ID | Test | Purpose | Expected result |
| --- | --- | --- | --- |
| C1 | True clean install | Remove developer-machine contamination | succeeds without Node/npm/repos/dev services |
| C2 | Unassisted onboarding | Validate product clarity | tester reaches READY using only in-app guidance |
| C3 | First ChatGPT task | Validate time-to-value | tester connects ChatGPT and completes harmless local task |
| C4 | Permission flow | Validate macOS UX | tester understands why each permission is requested |
| C5 | Restart next day | Validate persistence | app works again without reconfiguration |
| C6 | Failure report | Validate supportability | tester exports one diagnostics bundle without Terminal |

## D. Acceptance targets for next friend-beta

```text
P0 blockers: 0 open
A1-A12: pass
A15-A16: pass
B1: setup requires no Terminal/manual secret copying
B2/B6/B8: pass
Cloud Bridge: no persistent NOT_FOUND/degraded loop
Runtime reconnect: no sign-out/sign-in required
Tunnel: normal user does not enter Tunnel ID/API key
Overview: one unambiguous product readiness state
```

Recommended success criteria:

```text
clean install → READY: <= 5 minutes excluding email delivery
manual technical fields entered: 0
Terminal commands required: 0
unexpected app restarts: 0
launchd bootstrap error 5: 0 occurrences
re-login after Runtime restart: 0
first harmless ChatGPT local action: verified by Runtime evidence
```

## E. Test-result-driven optimization loop

```text
failure
→ classify canonical owner: Desktop / Runtime / Cloud / Tunnel / macOS permission / UX / packaging
→ add regression test first where feasible
→ implement smallest owner-correct fix
→ rerun affected test + adjacent regression set
→ record evidence here
```

Do not compensate for a Runtime or Cloud defect with duplicated logic in Desktop. Do not hide a failed component behind a green aggregate status.

## Current evidence from 2026-10-01 dogfood

| Test | Result | Evidence |
| --- | --- | --- |
| A1 packaged Runtime identity | PASS after stale dev :8788 was removed | production mode, ~/.owl-runtime, packaged release code root |
| A3 Desktop file write | PASS | `fs.write` created `~/Desktop/owl-runtime-test.txt`, verification=verified |
| A7 observation/verification | PASS | Runtime returned file metadata observation and verification checks |
| A8 no old computer-mcp dependency | PASS | :8789/:8791 stopped; OWL MCP still read created file |
| A9 Runtime restart + reauthorization | FAIL | Runtime recovered but stayed AUTHORIZATION_REQUIRED until sign-out/sign-in |
| A10 launchd lifecycle | FAIL | `launchctl bootstrap` returned error 5 after Desktop restart |
| A11 wrong port owner detection | FAIL | stale dev Runtime on :8788 was initially accepted as connected |
| A12 Cloud route compatibility | FAIL | repeated Cloud Bridge `NOT_FOUND` |
| B1 first-run comprehension | FAIL | login hidden under Runtime page; next action unclear |
| B11 connect ChatGPT | FAIL for target UX | manual Tunnel ID/API key configuration required |

These failures are the optimization backlog for the next artifact.
### Automated safety run — 2026-10-01

| Test | Result | Evidence / interpretation |
| --- | --- | --- |
| A2 Runtime access / mutation gate | PASS for current session | Runtime is READY and state-changing `fs.write` succeeded through OWL MCP |
| A3 allowed-folder write | PASS | Runtime created verified test files in Desktop, Documents and Downloads |
| A4 out-of-scope filesystem denial | PASS | `/tmp` returned `Access denied: path is outside ALLOWED_DIRECTORIES` |
| A5 delete default safety | SAFE but SPEC NEEDS CLARIFICATION | Delete did not execute; Runtime returned `APPROVAL_REQUIRED`. Current behavior is approval-gated rather than an immediate `ALLOW_DELETE=false` rejection at the first gate. Do not approve during this safety test. |
| A6 shell default denial | PASS | `sys.exec` returned `ALLOW_SHELL is disabled` |
| A7 Runtime verification evidence | PASS | Every successful `fs.write` returned observation + verification with file metadata |

Current packaged provider policy observed:

```text
allowedDirectories = ~/Desktop, ~/Documents, ~/Downloads
write = true
delete provider flag = false
shell = false
desktop provider = enabled
Helper = ~/Applications/OWL LAB Helper.app
Runtime-owned staging = ~/Library/Application Support/OWL LAB/staging
```

Test artifacts intentionally left in the safe allowed roots because delete is currently approval-gated:

```text
~/Desktop/owl-a3-desktop.txt
~/Documents/owl-a3-documents.txt
~/Downloads/owl-a3-downloads.txt
```

Remove them later through the normal approved cleanup path or Finder.
### Permission-baseline clarification — 2026-10-01

The owner’s development Mac installed and used filesystem primitives without opening macOS Privacy & Security, but this is **not clean-Mac evidence**.

Three permission layers must be tested separately:

1. Gatekeeper/quarantine: a locally built DMG may not carry the same quarantine state as a file downloaded on a friend’s Mac.
2. Files & Folders/TCC: Desktop/Documents/Downloads access must be tested on a machine with no prior OWL permission history.
3. Accessibility/Screen Recording: these are only exercised when the OWL LAB Helper actually performs GUI/perception work. During the current file-only dogfood, `admin.permission(status)` reported that the Helper had not created its Unix socket, so no GUI-permission conclusion can be drawn.

Add clean-Mac acceptance evidence for each permission class; do not infer permission UX from successful installation or filesystem-only tasks on the developer Mac.
### Additional automated findings — 2026-10-01

#### Cloud Bridge NOT_FOUND route diff

Desktop Cloud client vs current Cloud source vs latest local synth bundle:

```text
/device/v1/presence             source=yes  synth=yes
/device/v1/commands             source=yes  synth=yes
/device/v1/approval-decisions   source=yes  synth=NO
/device/v1/events               source=yes  synth=yes
/device/v1/telemetry            source=yes  synth=yes
```

This strongly identifies `/device/v1/approval-decisions` as the current `NOT_FOUND` source. Desktop calls it every sync cycle; the current source implements it, but the synthesized Lambda bundle under `cdk.out` does not. Cloud dev deployment should be refreshed from the current router, and Desktop should still capability-gate optional routes so one missing endpoint does not degrade the entire bridge.

#### Branding / packaging findings

- `scripts/prepare-macos-icon.mjs` still uses `assets/owl-desktop-icon.svg`; it does not yet use the owner-provided formal `assets/owl1254.png`.
- `latest-mac.yml` references hyphenated `OWL-LAB-Desktop-...dmg` filenames while the actual friend-beta files use `OWL LAB Desktop-...dmg`. Unify artifact naming before updater/public release.
- Current packaged Desktop `Info.plist` includes Camera, Microphone and Bluetooth usage strings although these are not part of the current first-run capability flow. Remove unused declarations to reduce permission confusion.
- Current Desktop ATS allows arbitrary loads. Production packaging should restrict transport security to loopback HTTP plus explicit Cloud HTTPS endpoints.

#### Background-mode finding

Current macOS code keeps the Electron process alive when all windows close, but has no Tray/Menu Bar implementation. `Cmd+Q` correctly stops Cloud Bridge, Runtime event bridge, Tunnel and MCP. Next beta should add a menu-bar status/control surface and make background-running behavior explicit to the user.
### Recovery hardening implementation run — 2026-10-01

Automated fixes implemented in Desktop source after the first installed-dogfood session:

| Area | Fix | Automated result | Live next-build result |
| --- | --- | --- | --- |
| MCP upstream disconnect | Once Runtime has accepted a request, upstream HTTP/tunnel disconnect no longer cancels the Runtime request | PASS: explicit accepted-request disconnect test | pending |
| MCP reconnect/session lifecycle | Session recovery window retained, idle sessions reclaimed, hard cap prevents unbounded session growth | PASS: 25 reconnect soak; cap <= 8 in test and TTL reclaim to 0 | pending |
| Tunnel crash | Unexpected tunnel child exit schedules bounded exponential restart; intentional stop disables restart | PASS | pending |
| launchd error 5 race | wait for teardown + bounded bootstrap retry | PASS unit regression reproducing error 5 on first bootstrap | pending |
| Healthy packaged Runtime startup | exact healthy packaged Runtime is left running rather than bootout/bootstrap on every Desktop launch | PASS | pending |
| Wrong Runtime on 8788 | validate `/health` production mode/stateRoot/codeRoot/release identity; reject foreign owner with `RUNTIME_PORT_CONFLICT` | PASS | pending |
| Runtime production state | bootstrap explicitly writes `OWL_RUNTIME_MODE=production` and `OWL_STATE_ROOT=~/.owl-runtime` | PASS | pending |
| Runtime reconnect authorization | Runtime snapshot now refreshes current Cloud access and re-projects lease when online but not READY | build PASS; requires real restart test | **pending B6/A9** |
| Tunnel/App branding | formal `assets/owl1254.png` now generates full macOS icns set | PASS arm64/x64 smoke packaging | visual owner check pending |
| Artifact naming | DMG artifact naming normalized to `OWL-LAB-Desktop-<version>-<arch>` | config/build PASS | next DMG pending |

Final automated regression after these changes:

```text
Vitest:             20 test files / 99 tests PASS
TypeScript + Vite:  PASS
release components: PASS
packaged smoke:     PASS arm64 + x64
formal icon source: assets/owl1254.png
```

Important boundary: these fixes make OWL resilient to transport/process interruptions inside the OWL stack. They cannot guarantee that the ChatGPT client UI or the user network never disconnects; instead, accepted work must survive such disconnects and be rediscoverable/recoverable.

Do not mark A9/B6/B8 PASS until the next packaged build is installed and the owner performs real Runtime/Desktop/reboot recovery tests.
### Cloud compatibility verification — 2026-10-01

Cloud source was tested with native arm64 Node 22.23.3 because the default `/usr/local/bin/node` is x64/Rosetta while the installed esbuild package is arm64.

```text
owl-cloud typecheck: PASS
owl-cloud tests:     52/52 PASS
I5 Approval E2E:     PASS
```

I5 evidence:
- approve resumes the same Runtime task;
- approval receipt is consumed;
- side effect executes exactly once;
- deny fails the task without executing the side effect;
- duplicate Cloud decision only replays acknowledgement;
- no replacement task is created.

Desktop now also tolerates an older Cloud deployment that returns 404/NOT_FOUND for `/device/v1/approval-decisions`: command/presence/event/telemetry sync remains connected, approval decision sync is projected as unavailable, and Desktop re-probes the endpoint after 60 seconds. This prevents one optional newer endpoint from degrading the entire bridge while Cloud deployment catches up.

After the fallback change, Desktop regression is:

```text
20 test files / 100 tests PASS
build PASS
```