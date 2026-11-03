# OWL LAB — Browser-Based SaaS Integration Reference

A **small, runnable, security-first demonstration** of how an independent assistant might read context from an existing web application, add a lightweight side panel, and prepare an operator-reviewed draft **without modifying the SaaS vendor's backend**.

**This is newly written example code, not extracted client software.** The sample application, identities, visit IDs, notes and UI are **entirely synthetic**. It contains **no real patient data, production endpoints, session material, or credentials**.

## Why this exists

Many organizations need to integrate assistants into SaaS products they cannot customize. A browser extension can provide an in-context entry point, while a **system-specific adapter** maps the host application's UI to a stable internal model. Operations should fail closed if identity, page version or write confirmation is uncertain.

This sample illustrates a conservative first step; it does **not** claim that a browser extension can safely integrate every SaaS product, nor does it replace the vendor's consent, terms, permissions or contractual restrictions.

## Run locally

Requirements: **Node.js 20+**, Chrome (or Chromium) and a development computer.

```bash
npm test
npm run audit:publish
npm run demo
```

Open **http://127.0.0.1:8765/**. In Chrome, visit **chrome://extensions**, enable Developer Mode and **Load unpacked** the root of this repository. The extension activates **only on the local demo URL** (see `manifest.json`). No external service is contacted by the extension.

### Walkthrough

1. The mock record shows patient `DEMO-PAT-001`, visit `DEMO-VIS-001` and clinician `DEMO-CLN-001`.
2. Click **Capture demo context** in the OWL LAB side panel.
3. Click **Insert synthetic draft**. The extension verifies that the patient, visit and clinician **still match**, then fills the editable note field; it does **not** submit.
4. Review the text and click the mock application's **Save note** button yourself. The local server returns an explicit acknowledgment and retains the note **in RAM only**.
5. Change a demo ID or enter text before trying to insert: the adapter **refuses** to overwrite or target an unknown context.

## Architecture

```text
Synthetic SaaS page (127.0.0.1:8765)
       |
       | DOM only, local allowlisted origin
       v
MV3 Chrome Content Script + isolated Shadow DOM panel
       |
       v
Context Guard (identity snapshot, field validation, fail-closed write)
       |
       v
Clinician / operator reviews the draft
       |
       v
Explicit local application's Save button -> mock server acknowledgment
```

`lib/context-guard.cjs` contains the testable, pure validation logic used by the extension. `extension/content.js` is the host-page adapter and review UI. `demo/server.mjs` supplies an in-memory demo. No AI model or audio capture is included: the example draft is static by design.

## Architecture trade-offs

| Pattern | Pros | Risks | Suggested use |
| --- | --- | --- | --- |
| **Browser extension + per-app DOM adapter** | Minimal changes to existing system, stays in operator workflow | DOM changes, iframe restrictions, permissions | First feasibility pilot with synthetic data |
| **Existing browser-facing HTTP endpoints** | May expose structured records more reliably than DOM | Often undocumented, fragile, access-control/contract concerns | **Only** if explicitly authorized by the SaaS owner/operator and clinically approved |
| **Reverse proxy / response rewriting** | Centralized rendering control | High operational, authentication and security complexity | Avoid as default for heterogeneous SaaS |
| **Official API / FHIR** | Stable schemas, clearer contract and lifecycle | May not exist or be available | Preferred long-term solution when offered |

## Integration contracts worth testing

- **Patient / visit / clinician binding** must remain stable from read to write.
- **No silent submission**: the user reviews before the host application commits.
- **Change detection**: unexpected selectors or UI updates block writes.
- **Receipt verification**: a filled form is **not** proof that the backend persisted it.
- **Least privilege**: permission limited to the explicitly approved host and page.
- **Audit and retention**: define purpose, roles, error handling and retention before production use.

See [SECURITY.md](SECURITY.md) for the limitations and production design questions.

## Deutsch — Kurzfassung

Dieses **vollständig synthetische Open-Source-Beispiel** demonstriert die mögliche Integration in eine bestehende SaaS-Weboberfläche ohne serverseitige Änderungen des Anbieters. Eine Browser Extension liest einen eng begrenzten Kontext, prüft die Identitätsbindung, fügt eine überprüfbare Entwurfsfunktion hinzu und überlässt die endgültige Speicherung dem Benutzer. Es ist **keine produktionsreife Healthcare-Integration**. Für den Einsatz mit Gesundheitsdaten wären zusätzlich unter anderem Berechtigungsprüfung, Datenschutz-Folgenabschätzung, Auftragsbearbeitungsverträge und klinische Sicherheitsfreigaben erforderlich.

## Scope and ownership

The architectural approach is informed by general experience building adapters for existing business web applications. **No source code, screenshots, data structures, endpoints or confidential implementation details from any third-party product are included.** Example only, MIT licensed.
