# Legacy Computer MCP Documentation Migration

Status: active migration map for OWL LAB.

The legacy `computer-mcp` repository still contains substantial product, runtime,
security and operations design history. These documents are not deleted. They
remain at:

```text
/Users/wahaha/Documents/Me/Project/cursor/computer-mcp/docs
```

The problem is ownership visibility: OWL LAB split the old monolith into Desktop,
Runtime, Cloud and Worker, but documentation ownership was never migrated
systematically. This index makes the transfer explicit.

## Rule

Do not blindly copy the legacy tree into OWL Desktop.

- Desktop owns product UX, onboarding, local control plane, device-facing settings,
  ChatGPT/Tunnel consumer lifecycle, permissions UX, local secrets UX and support.
- Runtime owns execution semantics, tasks, staging, scheduler, memory, Primitive/Skill
  ABI, state schema, workspace ownership, durable replay, policy and verification.
- Cloud owns account/org/device control plane, remote commands, remote approval relay,
  identity/bootstrap and future fleet/RBAC.
- Legacy version-specific implementation notes remain archived for provenance.

## Legacy documents and target owner

| Legacy document | Canonical target | Migration status |
| --- | --- | --- |
| architecture/control-center-and-cloud-accounts.md | Desktop + Cloud | ACTIVE: Desktop UX concepts retained; Cloud account control-plane semantics move to Cloud |
| architecture/concurrency-and-ownership.md | Runtime | Runtime-owned |
| architecture/cross-repo-coordination.md | Platform integration docs | Retain as historical input; current integration contract wins |
| architecture/layers.md | Runtime / Platform | Runtime-owned architecture |
| architecture/overview.md | Platform | Historical predecessor |
| architecture/owl-runtime-integration.md | Desktop integration | SUPERSEDED by current OWL Runtime integration, but migration rationale remains useful |
| architecture/records-and-observability.md | Runtime + Desktop | Runtime record truth; Desktop projection/UI |
| architecture/runtime-identity.md | Runtime | Runtime-owned |
| operations/chatgpt-onboarding.md | Desktop | MIGRATE into current onboarding flow |
| operations/configuration.md | Desktop + Runtime | Split by user settings vs execution policy |
| operations/fault-recovery.md | Desktop + Runtime | Split by local recovery vs execution recovery |
| operations/graceful-drain-and-handoff.md | Runtime | Runtime-owned |
| operations/new-machine-install.md | Desktop | MIGRATE into current installation/onboarding docs |
| operations/performance-p0.md | Runtime | Historical performance evidence |
| operations/production-promotion.md | Runtime / release | Runtime-owned |
| operations/production-runtime.md | Runtime | Runtime-owned |
| operations/production-upgrades.md | Runtime | Runtime-owned |
| operations/recovery.md | Runtime + Desktop | Split ownership |
| operations/soak-testing.md | Runtime | Runtime-owned |
| operations/troubleshooting.md | Desktop support | MIGRATE relevant user-facing remediation |
| operations/tunnel-client.md | Desktop | MIGRATE consumer lifecycle; remove manual credential UX in target product |
| security/audit.md | Runtime + Desktop projection | Runtime truth, Desktop viewer |
| security/credential-vault.md | Desktop local security UX + Runtime execution injection | MIGRATE concepts, preserve no-secret invariants |
| security/permissions.md | Desktop UX + Runtime enforcement | MIGRATE, with allowed-folders UI |
| security/privacy-and-secrets.md | Platform security | Re-home by owner |
| roadmap/v1.0.md | Archive | Legacy roadmap |
| roadmap/v1.1.md | Archive / product history | Legacy roadmap |
| roadmap/post-1.0.md | Archive / input | Re-evaluate against current OWL roadmap |
| roadmap/release-checklist.md | Desktop/Runtime release | Reconcile with current release gates |
| runtime/loop-controller.md | Runtime | Runtime-owned |
| runtime/scheduler-and-wake.md | Runtime | Runtime-owned |
| runtime/tasks-and-staging.md | Runtime | Runtime-owned |
| runtime/memory/** | Runtime | Runtime-owned |
| specifications/primitive-abi.md | Runtime | Runtime-owned canonical contract |
| specifications/skill-abi.md | Runtime | Runtime-owned canonical contract |
| specifications/session-adapter.md | Runtime / adapters | Runtime-owned |
| specifications/state-schema.md | Runtime | Runtime-owned |
| specifications/workspace-lease.md | Runtime | Runtime-owned |
| specifications/compatibility-policy.md | Platform/Runtime | Runtime contract |
| specifications/embedding-provider.md | Runtime | Runtime-owned |
| adr/0001-0011 | Runtime / Platform archive | Preserve ADR provenance; re-home only still-active decisions |

## Desktop concepts explicitly carried forward

The following legacy concepts remain valid and should not be lost:

### Control Center → OWL LAB Desktop

Legacy Control Center ideas map into the current Desktop product:

- local operational health;
- sessions / tasks / approvals;
- correlated logs;
- Needs Attention;
- credential metadata without raw secrets;
- cloud account projections;
- resource contention explanations;
- system doctor / repair actions.

The current OWL Desktop UI should simplify these rather than discard them.

### Credential Vault

Carry forward these invariants:

- secrets are not memories;
- raw secret values never enter logs, support bundles or chat history;
- OS credential storage is preferred;
- project/workspace bindings are explicit;
- execution resolves only the credentials required by that workspace/action;
- UI shows metadata/status, never plaintext values;
- high-impact credential changes require local confirmation.

### Permissions

Carry forward and modernize:

- filesystem access is explicitly scoped;
- high-impact capabilities are independent gates;
- Helper owns Accessibility/Screen Recording identity;
- Runtime owns enforcement;
- Desktop owns the user-facing permission manager.

Current target UI is `Settings → Files & folders`, not editing
`ALLOWED_DIRECTORIES` manually.

### ChatGPT / Tunnel onboarding

Legacy onboarding correctly established that users should not need to understand
ports, launchd, tunnel flags or secret-file paths.

OWL LAB takes this further:

```text
Install
→ Sign in
→ automatic local Runtime/device preparation
→ Connect ChatGPT
→ Ready
```

Tunnel ID, tunnel API key, MCP port and tunnel binary path become Advanced/internal
details rather than normal setup fields.

### Stable permission-bearing native apps

Carry forward the principle that normal Server/Runtime code updates should not
replace the macOS identities that own user-granted permissions.

For OWL LAB:

```text
fan.fde.owl.runtime
fan.fde.owl.helper
```

should remain stable permission identities across normal updates.

## Current Desktop documents that supersede legacy user-flow docs

- `docs/operations/ONBOARDING_AND_RECOVERY_V1.md`
- `docs/operations/FRIEND_BETA_FINDINGS_2026-10-01.md`
- `docs/operations/FRIEND_BETA_TEST_PLAN_V1.md`
- `docs/operations/FRIEND_BETA_TESTING.md`

Legacy documents remain useful historical evidence, but these current OWL LAB docs
are the active product direction.

## Next migration actions

1. Add a top-level `docs/README.md` in OWL Desktop so product/operations/security
   documents are discoverable.
2. Move Desktop-owned legacy concepts into current OWL docs with explicit provenance.
3. Create matching migration indexes in OWL Runtime and OWL Cloud for their owned
   legacy documents.
4. Freeze `computer-mcp/docs` as legacy reference after active content is migrated.
5. Do not delete the legacy docs until all target owners have canonical replacements.
