# Hosted OWL Cloud Runtime lease trust (source installations)

OWL LAB Runtime executes only after verifying a **device-bound, Ed25519-signed lease** from OWL Cloud. A working account login, Tunnel, or MCP transport does not prove Runtime execution is authorized.

## Supported first run on macOS

1. Clone current `owl-desktop` and `owl-runtime` next to one another, and install dependencies using `npm ci`.
2. Launch from `owl-desktop` using `npm run dev:full`. The supervisor uses the official Cloud HTTPS origin `https://yh9cjtolx6.execute-api.eu-central-1.amazonaws.com`.
3. When no verifier is installed, Desktop fetches public metadata from `GET /trust/runtime-lease/v1`. The response contains **only** the active signer public key, Ed25519 algorithm, key identifier and SPKI SHA-256 fingerprint.
4. The downloaded key is **rejected unless its SHA-256 SPKI fingerprint matches the value pinned independently in** `scripts/lib/runtime-lease-trust.mjs`. The current DEV verifier fingerprint is:

   `338c53a1171f7d11bd13b96a916b1752af03317d483ee6ae6918d885686409b7`

5. The validated public key is installed at `~/.owl-lab/trust/owl-cloud-dev-runtime-lease-public.pem` and inherited by the Runtime via `OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE`.
6. Sign into OWL Cloud, enroll your device if necessary, and use **Reauthorize**. When Cloud returns a valid device-bound lease, Runtime verifies its signature and enters `READY`. A new trial normally grants Runtime for 30 days, subject to active device, account state and trial limits.

**Never** run `provision:runtime-lease-key` as an ordinary hosted Cloud user; it provisions a *different* signing key for Cloud operators. Do not request the server's private key, generate a fake lease or set `OWL_RUNTIME_ACCESS_MODE=compat` to bypass enforcement.

## Trust errors

- `RUNTIME_LEASE_TRUST_BOOTSTRAP_FAILED`: endpoint unavailable, older Cloud deployment, network error or HTTP 503. The maintainer must deploy the published trust endpoint and ensure hosted signing is configured.
- `RUNTIME_LEASE_TRUST_FINGERPRINT_MISMATCH`: downloaded PEM or existing file differs from the independently pinned official DEV signer. **Stop**; don't accept unknown material.
- `RUNTIME_LEASE_TRUST_ROTATION_REQUIRES_REVIEW`: the Cloud signer rotated. A verified operator must publish the new fingerprint and a reviewed source update. Do not silently replace an existing trust anchor.
- `RUNTIME_ACCESS_LEASE_KEY_MISSING`: Runtime process lacks a readable public key.
- `RUNTIME_ACCESS_DEVICE_MISMATCH`, `CLOUD_DEVICE_RUN_NOT_GRANTED`, `CLOUD_ENTITLEMENT_NOT_ACTIVE`: check the selected Cloud account, active device ownership and entitlement.
- `ACCOUNT_LOGIN_REQUIRED` with `grant:null` after Cloud login may be **stale Runtime lock state**. Use the specific code in the Desktop authorization failure (and logs); don't blindly re-register or repeat login.

For an explicitly self-hosted Cloud, operator must provide its own independently verified public key via `OWL_RUNTIME_LEASE_PUBLIC_KEY_FILE`, and may specify `OWL_RUNTIME_LEASE_EXPECTED_SPKI_SHA256`. Automatic hosted-key discovery is restricted to OWL's exact official HTTPS origin.

## Local service recovery independent of Tunnel

For a source/dev install, keep the coordinator (`npm run dev:full`) alive. Exiting the Electron child can cause a temporary dev supervisor to stop its Connection Host even though an independently operated OpenAI Tunnel reports `ready`. This does **not** imply a crash. Do not recreate the Tunnel or device just to restart local services.

Inspect listening services (macOS):

```bash
lsof -nP -iTCP:18788 -sTCP:LISTEN
lsof -nP -iTCP:8790 -sTCP:LISTEN
lsof -nP -iTCP:8791 -sTCP:LISTEN
```

If 8790/8791 are absent, restart the supported Desktop + Connection Host coordinator and refresh Desktop status. The Connection Host health endpoint requires its own bearer credential; avoid posting that token, arbitrary HTTP headers or full diagnostic logs publicly. Tunnel health establishes *only* control-plane readiness, not authenticated end-to-end local MCP reachability.

When `LOCKED`, Desktop now skips protected approval polling and retains the specific reason for a failed lease projection. Do not enable `ALLOW_SHELL`, `ALLOW_BROWSER`, `ALLOW_GUI`, etc. solely to debug lease trust; local action permissions are independent from account authorization.

## Operator notes

Cloud's public `/trust/runtime-lease/v1` endpoint is served by the same signer (from AWS Secrets Manager) used for `/v1/devices/{id}/runtime-lease`. Before publishing a new release or rotating the Cloud signing secret, derive the Ed25519 SPKI SHA-256 from the active AWS signer, publish the reviewed hash and update the Desktop trust pin together. Private keys and raw signed lease tokens must never be published. A staged overlap/rotation policy is still needed for routine key rotation; absent that, clients intentionally fail closed.
