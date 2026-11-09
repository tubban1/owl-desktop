# OWL LAB legacy compatibility retirement — 2026-11-09

## Retired in source

| Layer | Retired | Evidence |
| --- | --- | --- |
| Desktop browser | Chrome Companion separate extension, pairing broker (localhost :8794), 11 `browser_companion_*` MCP tools and dedicated test scripts | `owl-desktop` commit `30e3527`; actual MCP tool catalog 151; 169 test files / 771 tests pass, TypeScript and Vite build pass |
| Desktop browser | Legacy `OWL_CHROME_BACKEND=devtools` / `chrome-devtools-mcp` backend | No current browser workflow requires global Chrome debugging; official Native Messaging on :8795 remains |
| Runtime proxy | 11 legacy Companion proxy registrations; misnamed bridge module renamed to Desktop Agent Browser | `owl-runtime` commit `090474a`; TypeScript builds; owner, allowlist, loopback test passes |
| Cloud entitlement | Per-org DEV QA two-device Trial override | `owl-cloud` commit `32c14bc` deployed to Frankfurt DEV; Trial defaults to two devices; Cloud typecheck and tests pass; Cloud health HTTP 200 |

## Deferred — not safe to delete based on naming alone

1. **Cloud DEV JWT bypass:** `OWL_MCP_ALLOW_LEGACY_USER_JWT=true` is still enabled in CDK. Removing it requires validating all public MCP clients use scoped resource-bound access tokens, followed by authenticated live smoke tests. It is an authentication migration, not a no-op code deletion.
2. **Windows recovery bridge:** standalone Computer MCP (:8787), `dual-mcp-guardian.ps1` and `manual-peer-restart.ps1` are still an independent rescue mechanism. Windows OWL currently runs older source and its tunnel is not verified ready; do not remove independent rescue until durable OWL MCP parity and recovery are proven.
3. **Runtime storage migration:** `legacyStorageMigration.ts` remains invoked by the public storage inventory and migration API. Require a non-destructive inventory and an owner-approved data-retention decision before deleting storage migration support.
4. **Active protocol enforcement:** `electron/services/compatibility-v1.mjs` currently validates Runtime API and remote command kind versions. It is not unused dead code.
5. **Active generic browser routing:** `mcp/browser-compat-router.mjs` routes normal `browser_open` to Native Chrome by default and an explicitly isolated browser when requested. It remains a used routing layer despite its name.
6. **OTA rollback guardians and old release folders:** fallback jobs and prior release assets are recovery mechanisms. Do not delete active/fallback launchd jobs or startup rollback data before a verified, non-disruptive update policy.
7. **Native Messaging (:8795) and Electron bridge (:8792):** current Agent Browser requirements; keep. Do not shut down Chrome or its existing Native Host during source cleanup.
8. **Security kill switch:** `OWL_COMPANION_BRIDGE_DISABLED` is still consumed by Runtime's now-renamed Agent Browser bridge, retained to avoid silently re-enabling an intentionally disabled browser capability. Rename only after deployment configuration audit.
9. **OWL Worker mock/projection:** currently used for mock previews and support UI; no evidence of a deprecated production fallback.

## Activation gate

Browser code is committed **locally only**. Do not automatically publish to `owl-desktop/main` while OTA can activate during a foreground session: the updater currently allows all hours (`inWindow() { return true; }`). Mac/Windows must first pass the same revision and Agent Browser Native Messaging parity check, including a controlled restart/reload and rollback proof. As of this audit Windows' running MCP revision lags GitHub `main`.

Removing files is not proof that the listening :8794 process has stopped: old processes keep running until a subsequent safe activation. Verify the listener disappears after a controlled cutover, then verify :8795 remains healthy.

## No-touch boundaries

Do not remove user browser profiles, existing tabs, encrypted keys, Cloud entitlements, storage databases, unrelated temporary working files or active recovery tasks.
