# OWL LAB Desktop — Real Install Findings (2026-10-01)

Status: **HOLD FRIEND DISTRIBUTION UNTIL P0/P1 ITEMS ARE CLOSED**

## Proven working

The installed arm64 friend-beta-final completed a real end-to-end action:

```text
ChatGPT
→ OWL Tunnel
→ OWL MCP :8790
→ packaged OWL Runtime :8788
→ Primitive ABI v1 fs.write
→ ~/Desktop/owl-runtime-test.txt
→ Runtime observation + verification = verified
```

Packaged Runtime identity was verified as:

```text
mode      = production
stateRoot = ~/.owl-runtime
codeRoot  = ~/.owl/releases/1.0.0-rc.4-d6320d29941f...
version   = 1.0.0-rc.4
```

After stopping the old development computer-mcp on :8789 and Control Center on :8791, ChatGPT still read the test file through the new OWL stack. The installed product no longer depends on `npm run dev`.

## Release blockers discovered

| Priority | Finding | User impact | Required change |
| --- | --- | --- | --- |
| P0 | No first-run onboarding | User sees a locked Runtime and does not know what to do | Add setup wizard and one clear next action |
| P0 | Runtime reconnect does not re-project Cloud execution lease | Runtime can recover but stay LOCKED until sign-out/sign-in | Re-authorize automatically after Runtime reconnect |
| P0 | launchd restart race | Reopen can fail with bootstrap error 5 | Idempotent service lifecycle; wait for teardown; bounded retry |
| P0 | Wrong Runtime can be accepted on :8788 | Stale dev Runtime was initially treated as the installed Runtime | Verify production mode + exact release identity, not only API health |
| P1 | Account can show ready while Runtime is locked | UI reports success before execution is actually ready | Separate identity-ready from execution-ready |
| P1 | Cloud Bridge repeatedly returns NOT_FOUND | Bridge stays degraded and logs noise | Align deployed Cloud API and Desktop client contract |
| P1 | Tunnel configuration is manual | User must understand Tunnel ID/API key/MCP port | Cloud-managed tunnel provisioning and automatic lifecycle |
| P1 | Top-level Connected is ambiguous | Local connectivity can look healthy while product is not usable | Aggregate product readiness with one next action |
| P1 | Settings expose transport internals | Configuration is too technical | Move endpoints, ports, IDs and binary paths to Advanced |
| P1 | Release directory is confusing | Tester sees DMGs, blockmaps and unpacked apps | Publish a clean tester-only distribution directory |
| P2 | Troubleshooting is log-centric | User must understand internal logs | Add Repair Runtime, Reauthorize, Reconnect ChatGPT and Export diagnostics |

## Captured launchd failure

```text
launchctl bootstrap gui/501 .../com.owl.runtime.plist
Bootstrap failed: 5: Input/output error
```

Current startup unconditionally bootouts and immediately bootstraps the service. The target lifecycle is:

```text
inspect service + plist
→ healthy/current: leave running
→ restart required: bootout
→ wait until launchd teardown completes
→ bootstrap with bounded retry/backoff
→ kickstart if needed
→ verify exact packaged Runtime identity
→ restore Runtime access projection
```

## Captured authorization failure

Observed:

```text
Account          Authenticated
Cloud run access Granted
Runtime          LOCKED / AUTHORIZATION_REQUIRED
```

`Refresh Runtime` only re-reads status. It does not re-project an execution lease. Sign-out/sign-in while the packaged Runtime was healthy moved it to READY. Target behavior is automatic lease recovery without re-login.

## Captured Cloud Bridge failure

```text
Cloud Bridge sync failed
code = NOT_FOUND
```

Treat this as Desktop/Cloud contract or deployment drift until the exact missing route is fixed. Repeated polling errors must be deduplicated and backed off.

## Product UX conclusion

The normal user should only need:

```text
Install
→ Sign in / create account
→ automatic local setup
→ Connect ChatGPT
→ grant permissions when first needed
→ Ready
```

Normal users should not type Tunnel ID, API keys, ports, binary paths or Cloud endpoints.

## Friend-beta decision

The current final DMG is a useful internal dogfood artifact and proves the architecture, but it should not be sent broadly to friends until the P0/P1 onboarding, recovery, launchd and Cloud Bridge issues are fixed.
## Optimization sequence based on current evidence

Do not develop these in parallel. Use serialized integration so each layer has one source of truth.

### Phase 1 — Local lifecycle correctness (P0)

Owner: OWL Desktop, with Runtime contract unchanged unless a real contract gap is found.

1. Fix launchd lifecycle race: inspect-before-restart, teardown wait, bounded retry.
2. Strengthen bootstrap identity verification: production mode, expected state root, exact release identity/code root.
3. Detect foreign/stale owner of port 8788 and show an actionable conflict instead of accepting it.
4. On Runtime unreachable → healthy transition, automatically refresh Cloud effective access and renew/project the Runtime lease.
5. Make account status distinguish identity-ready from execution-ready.

Exit criteria: A1, A2, A9, A10, A11 pass repeatedly.

### Phase 2 — First-run onboarding and product readiness (P0/P1)

Owner: OWL Desktop UX.

1. Add Welcome / Sign in first-run flow.
2. Add setup stepper for Runtime, device, execution access and ChatGPT connection.
3. Replace ambiguous top-level Connected badge with aggregate readiness + one next action.
4. Add Repair Runtime and Reauthorize actions.
5. Move raw endpoints, ports, tunnel binary and IDs to Advanced.

Exit criteria: B1 passes without Terminal or documentation.

### Phase 3 — Cloud contract and managed tunnel (P1)

Owner: OWL Cloud for provisioning/contract, OWL Desktop for consumer lifecycle.

1. Resolve current Cloud Bridge NOT_FOUND by diffing deployed routes against Desktop client.
2. Add explicit Cloud contract/capability version gate before polling.
3. Deduplicate/back off repeated Cloud errors.
4. Provision tunnel identity/credential from Cloud after device enrollment.
5. Desktop starts tunnel automatically and exposes a single Connect ChatGPT action.
6. Remove Tunnel ID/API key entry from normal user flow.

Exit criteria: A12-A14 and B11 pass.

### Phase 4 — Permissions and supportability (P1/P2)

1. Progressive Accessibility/Screen Recording prompts.
2. Permission denial recovery messages.
3. Export redacted diagnostics bundle.
4. One-click Test connection using a harmless verified file action.
5. Clarify delete semantics: provider disabled vs approval-gated behavior.

Exit criteria: A5, A18, B4, B5, B10, B13 pass.

### Phase 5 — Release packaging and clean-Mac dogfood

1. Produce a clean tester-only distribution folder.
2. Run component verification and packaged smoke for arm64/x64.
3. Owner quit/reopen, logout/login, reboot, offline/online and reinstall tests.
4. Only then send to clean friend Macs.
5. After friend-beta stabilizes: Developer ID, signing, notarization and production Cloud promotion.

Exit criteria: all next-beta acceptance targets in FRIEND_BETA_TEST_PLAN_V1.md pass.