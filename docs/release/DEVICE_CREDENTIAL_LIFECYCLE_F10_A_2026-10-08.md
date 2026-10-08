# F10-A — Cloud Device Credential Lifecycle Acceptance (2026-10-08)

**Scope:** Cloud-managed device credential rotate/revoke, local Desktop rebinding,
fail-closed cleanup, device UX and Runtime explicit revocation correctness.
**Status:** Isolated source-level and in-memory service verification PASS.
**Not:** actual registered device rotation, live Frankfurt deployment, Runtime API
token rotation or Custom Tunnel API-key rotation.

## Exact code
- Runtime: commit `5a7e37b`, explicit REVOKED cannot be bypassed in compat.
- Cloud server: unchanged `9cd8f29`; device rotate/revoke routes already exist.
  PostgreSQL rotate updates credential_hash inside a transaction; revoked devices
  no longer authenticate. Non-owners cannot rotate/revoke.
- Desktop: device-credential-lifecycle with independent rebind stages and
  fail-closed old Cloud MCP consumer fallback. Local revoke attempts every
  cleanup stage after successful Cloud revocation, even when one fails.
- Desktop UI: only enrolled current device shows rotate/revoke controls;
  dangerous revoke action requires explicit confirmation. IPC returns safe
  device metadata, not the rotated credential.
- Old device secret stays in the OS-backed vault only until replaced/removed;
  the Cloud response secret is not returned to renderer.

## Tests
- Cloud `./node_modules/.bin/tsx --test test/control-plane.test.ts`:
  **30/30 PASS**, including old-key rejection, revoked-key rejection and
  owner authorization.
- Desktop F10 focused regressions: **22/22 PASS on initial run; 10/10 focused F10 tests after degraded-result gate** initially, then 9/9
  specialized rotate/revoke fault regressions after Runtime REVOKED correction.
- Desktop full `npm run verify:dev`: **69/69 test files, 311/311 tests,
  TypeScript/Vite build, git diff --check and durable-submit PASS**.
- Runtime `npm run typecheck`: PASS.
- Runtime `npm run verify:runtime-access-state`: PASS on arm64 Node 22.23.3.
  It now additionally verifies explicit REVOKED blocks `fs.write` in compat.
- Rosetta x64 Node 23 rescue shell could not execute tsx because the installed
  esbuild was arm64; arm64 Node 22 verification subsequently PASS. The
  production Runtime install was not changed.

## Failure handling
- Explicit returned status running=false / ready=false is a rebind failure,
  even when a Promise resolves without throwing.
- Cloud rotate succeeds, one or more local rebinds fail: all rebinds are
  attempted; failure is reported as DEVICE_CREDENTIAL_REBIND_INCOMPLETE;
  stale Cloud MCP consumer stop is attempted if Cloud MCP rebind fails.
- Cloud revoke succeeds, one local teardown fails: cleanup continues through
  credential removal, Bridge, Cloud MCP, Tunnel, local settings and Runtime
  revocation. Failure is reported as
  DEVICE_REVOCATION_LOCAL_CLEANUP_INCOMPLETE.
- Runtime revoke must return state REVOKED, not merely a truthy object or LOCKED.
- Cloud revoke fails before server confirmation: local identity is retained for
  repair/retry, not claimed revoked.

## Not yet production accepted
1. Real Frankfurt registered-device rotation and immediate revocation across
   an already active remote Host.
2. Revocation initiated remotely by an admin while Desktop is offline:
   transport 401 must degrade and local execution authority must reconcile.
3. Runtime API token rotation (distinct from Cloud device credential).
4. Custom Tunnel API Key rotation and provider-level old-key revocation.
5. Signed, notarized packaged Host credential reload, upgrade and rollback.
6. Combined fault during Cloud ACK/replay, credential rotation and reconnect.

This is **F10-A isolated Cloud device credential acceptance**, not blanket F10
production release closure. No real credentials were rotated or revoked in this
run. No production Runtime, Tunnel or Host was restarted.
