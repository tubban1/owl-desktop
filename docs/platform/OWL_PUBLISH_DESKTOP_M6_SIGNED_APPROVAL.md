# OWL Desktop M6 — OS-backed signed approval

Date 2026-10-14. Branch feat/owl-publish-desktop-human-signer-m6.
Status: SOURCE VERIFIED, NOT MERGED/INSTALLED.

- Desktop owns Ed25519 private signing key protected by Electron safeStorage at rest. Only the public key reaches Runtime.
- Each runtime approval is read back before signing, shown in a native macOS dialog with action, task, step, expiry and safe exact parameters. Signed proof is sent through approvals.approve after explicit confirmation. Incomplete review, including raw Shell command, is denied.
- Blocked/Review capability policy projects only selected review actions into OWL_SCOPED_ACTION_ALLOWLIST. A Blocked action never inherits another action's approval.
- Bootstrap rejects Review when bundled Runtime does not explicitly advertise humanApprovalSignatureV1 and scopedCapabilityV1. Existing rc.4 fails closed; do not relabel or change it.
- 83 Desktop test files, 366 tests and production build PASSED. Later additional 17 focused signer/old-rc4 permission tests PASSED. Runtime build plus Publish M5/M6 and cross-repository signature verification PASSED.
- No native hardware biometric user presence proven; software secureStorage and dialogs can potentially be driven by GUI automation. A trusted OS presence challenge and signer rotation are still production gates.
- Real official social API Provider/OAuth, private YouTube pilot and public Instagram approval tests are still pending. No deployments, restarts, production uploads, fees or remote push.

OWL Publish mainline next: local governed official YouTube/Instagram Provider + vault OAuth, followed by specifically authorized private YouTube test. All paid automatic API calls remain disabled; per-brand monthly defensive API budget is $1.
