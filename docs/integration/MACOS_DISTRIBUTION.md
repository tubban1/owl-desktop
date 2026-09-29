# macOS Distribution

Status: **Production packaging workstream**.

## Release identities

OWL Desktop and OWL Runtime Host have independent identities.

```text
OWL Desktop       ai.owl.desktop
OWL Runtime Host  fan.fde.owl.runtime
```

The Runtime Host is permission-bearing and must not be replaced by an ordinary Desktop update.

## Architectures

Supported release targets:

- arm64 — primary Apple Silicon build;
- x64 — Intel compatibility build.

Development `package:mac` defaults to arm64.

Artifact names contain architecture so one build cannot overwrite the other.

## Output separation

Vite renderer output:

```text
dist/
```

Electron release artifacts:

```text
release/
```

This prevents packaging from mutating renderer build output.

## Development smoke

```bash
npm run package:mac:smoke:arm64
```

This creates an unsigned unpacked arm64 application for structural verification.

## Formal release gate

```bash
npm run verify:mac:release
npm run package:mac:release
```

Release verification fails unless all are true:

- macOS build host;
- custom `build/icon.icns`;
- valid Developer ID Application identity;
- Apple Team ID;
- notarization credentials.

Formal config enables:

- hardened runtime;
- Electron JIT entitlements;
- Developer ID signing;
- notarization;
- arm64 and x64 artifacts.

## Not yet solved by packaging alone

The Desktop DMG is not allowed to silently overwrite the stable Runtime Host.

First-run/update orchestration must:

1. detect installed Runtime Host identity/version;
2. preserve it when compatible;
3. install it only when missing;
4. require an explicit native-host upgrade when identity/version changes;
5. re-check permissions after a native-host upgrade.

## Version matrix

A production Desktop release records exact tested versions for:

- Desktop SHA/version;
- Runtime API/version/SHA;
- Runtime Host version/bundle ID;
- Tunnel protocol/binary version;
- Cloud API/access contract;
- Helper native version where applicable.

## Self-contained Runtime delivery

OWL Desktop does not require the customer to install Node.js.

The packaged Electron executable is also the Runtime's Node host:

```text
ELECTRON_RUN_AS_NODE=1
OWL Desktop.app/Contents/MacOS/OWL Desktop
  → ~/.owl/current/dist/server.js
```

The release package carries a versioned Runtime archive with an exact Runtime version, Git SHA, API version, fingerprint and archive SHA-256.

Desktop installation extracts the immutable archive into the Runtime release area. The stable native OWL Runtime Host starts that release. Runtime state remains outside the application bundle.

Validated development path:

```text
OWL Runtime Host 1.0.0
→ packaged OWL Desktop arm64 executable / Node v22.22.0
→ extracted OWL Runtime 1.0.0-rc.4
→ Runtime API 0.1
```

This preserves the native Host permission identity while allowing Runtime code and Desktop code to have independent release lifecycles.

## Current formal-release blockers

The release gate intentionally remains closed until real provider/release assets exist:

- branded `build/icon.icns`;
- versioned x64 OWL Tunnel artifact;
- signed universal OWL Runtime Host artifact;
- Developer ID Application identity;
- Apple Team ID and notarization credentials.

Development smoke artifacts may be unsigned. They must never be labeled as a production release.
