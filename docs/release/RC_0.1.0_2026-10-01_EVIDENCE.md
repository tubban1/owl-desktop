# OWL LAB Desktop 0.1.0 — RC Evidence 2026-10-01

Candidate: `desktop-0.1.0-rc-20261001-27f6c3e`

Status: **unsigned internal RC**. Functional and packaging gates pass. Public distribution remains blocked only by Apple Developer ID / notarization credentials on the current release machine.

## Exact source set

- OWL Desktop final code assembly: `27f6c3e`
- Human-centered Desktop implementation: `807d895`
- OWL Runtime canonical main: `4e24c19fef12704eb5fe97c1283a3d8c32a4df4c`
- Runtime version: `1.0.0-rc.4`
- Runtime public API: `0.1`
- OWL Tunnel: `0.0.15`, vendor SHA `a390c168ff1b2d14e73a95991c186c6aba3ff5a0`

Runtime PR #21 was merged to main only after the 1.x Runtime Integration Freeze Gate completed successfully.

## Final DEV acceptance

Desktop DEV was run against the canonical Runtime main worktree at `4e24c19`, not the temporary integration branch.

Real self-dogfood flow:

```text
ChatGPT
→ OWL Tunnel
→ OWL MCP
→ canonical OWL Runtime DEV
→ OWL Desktop / local repositories
```

Live OCR of the actual `OWL LAB — Desktop` window verified:

- primary navigation: Home / Requests / Activity / Skills / Accounts / Settings;
- Sessions / Runtime / Secrets are under Advanced;
- Wake name and aliases are visible in everyday Settings;
- Allowed folders are visible, addable through native macOS directory selection, and removable;
- Home separates PRODUCT READINESS from WHAT OWL IS DOING;
- Ready + no active work projects Idle;
- a real Runtime-managed `sleep 10` process projected Working, command text, elapsed time and one running process;
- after process exit 0, Home automatically returned to Idle through quiet 3-second Runtime polling;
- historical log errors no longer falsely override current work state.

Deterministic projection tests cover Idle, Working, Waiting, Possibly stuck, task failure, durable-event reconciliation and readiness failure.

## Source and Runtime integration gates

Current final source gate:

```text
23/23 test files
116/116 tests
TypeScript PASS
Vite production build PASS
git diff --check PASS
durable submit/replay PASS
```

Live Desktop MCP E2E:

```text
PASS tool discovery
PASS RuntimeClient info
PASS MCP Agent Inbox discovery
PASS MCP → Runtime git.query → local repository
PASS deterministic read-only retry
PASS MCP detached task start/status
PASS same logical owner reconnect
```

The earlier apparent 10-second Runtime timeout was diagnosed as a verifier orchestration self-deadlock: an outer `workspace_mode=write` command held an exclusive workspace lease while the nested E2E asked the same Runtime to access that workspace. No product timeout was widened. Re-running without the conflicting outer write lease passed.

## Packaged local Runtime bootstrap

`verify:local-bootstrap-live` passed using the rebuilt vendor release components.

It verified:

- bundled Runtime starts under launchd;
- Runtime API `0.1` / version `1.0.0-rc.4`;
- Runtime Host installed;
- OWL LAB Helper installed;
- Runtime API token persisted through the Desktop vault boundary;
- default allowed folders and capability policy;
- realpath-equivalent macOS paths such as `/var` and `/private/var` are treated as the same Runtime identity.

## Release components

Rebuilt from exact sources:

- embedded Runtime SHA: `4e24c19fef12704eb5fe97c1283a3d8c32a4df4c`
- embedded Runtime archive SHA256: `1234921fb78c4cd973f268946a01ecd73033c6938f62cc20b1c47c6ff8ce1f99`
- Runtime Host: universal arm64 + x86_64
- OWL LAB Helper: universal arm64 + x86_64
- Tunnel: arm64 + x64 SHA verified
- release-components verifier: PASS
- packaged smoke arm64 + x64: PASS

## Internal RC artifacts

Directory: `release/rc-20261001`

```text
ef427fcd7d7511fb849fc774eeba25ae321fc0175b2cde5b981f3d492c548644  OWL-LAB-Desktop-0.1.0-arm64.dmg
cdf638690a2f02fc88f80b77bfc2b814ec4fb14669884dc7f08edf39f4ecb96b  OWL-LAB-Desktop-0.1.0-arm64.zip
76d04eac229bfdb3fbd8759585aa70737162a80e334f22114078946923a1848f  OWL-LAB-Desktop-0.1.0-x64.dmg
fbb24c5d7516b2d9cfe7be2cc5dfbc0538654ed04a0a0513153f47efc11829ef  OWL-LAB-Desktop-0.1.0-x64.zip
```

SHA256 read-back passed for all four artifacts.

`hdiutil verify` reports both DMG images as valid.

Both packaged architectures embed the same Runtime SHA and Runtime archive SHA. Desktop binaries match their target architecture; Runtime Host and Helper remain universal.

## Public release blocker

`npm run verify:mac:release` correctly fails closed because the current Mac has:

```text
0 valid Developer ID Application identities
APPLE_TEAM_ID missing
notarization credentials missing
Runtime Host lacks non-ad-hoc Developer ID signature
OWL LAB Helper lacks non-ad-hoc Developer ID signature
```

Therefore these artifacts are suitable for internal RC testing only. They must not be represented as a signed/notarized public release.

The next public-release action is credential/provisioning work, not another code change.
