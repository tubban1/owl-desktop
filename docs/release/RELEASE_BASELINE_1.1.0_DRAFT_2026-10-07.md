# OWL LAB Desktop 1.1 — Draft Release Baseline

Status: **local integration baseline; not a release candidate yet**

Date: 2026-10-07

## Product intent

OWL LAB 1.0 remains the internal execution foundation. The first intended
public product release is 1.1.

The Desktop package itself still reports development version `0.1.0`.
Do not change the application version to 1.1.0 until the 1.1 release gates are
actually closed.

## Exact current local source set

| Component | Revision | Publication state |
| --- | --- | --- |
| OWL Desktop | `becb35492d19e312f9631996e8c7b4d58f46d11b` | local main; 2 commits ahead of origin |
| OWL Runtime | `893a5a98f159ce98212dd728afabd8889630d26e` | local main; 1 commit ahead of origin |
| OWL Cloud | `9cd8f291e3dc5183e2e4504bd4a2bd5050c32b4b` | origin/main aligned |
| OWL Worker | `dfd58b208bcb2294e32fb2bbbd2c2c1ccec15d1f` | frozen during serialized integration |
| OWL Tunnel | vendor `0.0.15`, git `a390c168ff1b2d14e73a95991c186c6aba3ff5a0` | existing component contract |

Runtime product identity remains:

```text
version:    1.0.0-rc.4
public API: 0.1
```

## Reliability P0.2 carried into this baseline

This baseline must preserve:

- one authoritative OWL Tunnel generation;
- no legacy Computer MCP/AgentOS tunnel auto-start;
- bounded transient Runtime session lifecycle;
- implicit workstream GC;
- compact Connection Host `/health`;
- diagnostics split to `/diagnostics`;
- incremental Connection Host event cursor;
- classified managed-process failures;
- macOS reclaimable-memory resource admission;
- visibility-aware Monitor polling;
- idle graph animation suspension.

Canonical closure record:

```text
owl-lab-workspace/RELIABILITY_P0_2_2026-10-07.md
```

## Runtime component pin

New local release staging must use:

```text
893a5a98f159ce98212dd728afabd8889630d26e
```

The historical 0.1.0 internal RC used `4e24c19f...`. That historical record is
not rewritten.

## Current publication blocker

The active Runtime SHA is not yet published to the canonical GitHub repository
because local Runtime policy keeps Git push disabled.

Therefore:

- local staging from the exact sibling `owl-runtime/main` checkout is valid;
- a clean machine or CI checkout must fail closed until the exact Git object is
  published;
- release tooling must not silently fall back to the old remotely available
  Runtime SHA.

Desktop source is also locally ahead of origin. Publishing source is a separate
explicit governance step.

## Gates before this becomes a 1.1 release candidate

### P0 product/runtime

- exact packaged Runtime identity;
- launchd repeated restart without bootstrap error 5;
- wrong Runtime/foreign port owner rejected;
- Runtime reconnect restores effective execution authorization without re-login;
- aggregate product readiness never reports READY while Runtime execution is
  locked.

### Product onboarding

- first-run setup requires no Terminal;
- normal user enters no Tunnel ID, API key, port or binary path;
- one aggregate readiness state and one primary next action;
- Repair Runtime / Reauthorize / Reconnect ChatGPT are available in product UX.

### Cloud / transport

- Cloud Bridge contract is re-verified against current Frankfurt deployment;
- no persistent NOT_FOUND loop;
- managed tunnel provisioning is the normal path;
- Custom Tunnel remains Advanced only.

### Release

- current Runtime pin published and reproducible from a clean checkout;
- arm64/x64 release components verified;
- packaged smoke passes for both architectures;
- clean-Mac dogfood passes;
- Developer ID signing/notarization requirements are satisfied for public
  distribution.

## Version rule

Do not create a fake 1.1 release by changing version strings before the gates
above pass.

When these gates close, create a new immutable 1.1 release-candidate manifest
instead of editing `RELEASE_CANDIDATE_0.1.0.json`.
