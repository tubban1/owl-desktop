# Security and publication scope

This repository is a **non-production demonstration** using synthetic-only identifiers and no real medical data.

## Boundaries enforced in code

- The Chrome extension's `host_permissions` and `content_scripts.matches` are limited to local HTTP on port **8765**. No `<all_urls>`, debugger, cookies, webRequest, storage, or broad browser privileges are requested.
- A context snapshot must include a demo-formatted patient ID, visit ID and clinician ID; changes between capture and write **block** the operation.
- A write is allowed only into an empty enabled textarea recognized by the demo adapter, with a bounded synthetic note. No network fetch, password capture, recording, background submission or automatic saving.
- The demo HTTP server binds to `127.0.0.1` and stores the submitted synthetic note in memory only. Nothing is written to disk.
- The public Git repository is **not** forked or copied from a customer's, employer's or SaaS vendor's implementation.

## Not suitable for real patient/clinical records

In a real integration, obtain explicit organizational and provider authorization and assess contractual terms; use strong staff/patient/encounter identity verification, clinically reviewed workflows, data minimization, audit durability and access control. An internal endpoint found in a web app is **not automatically a supported or permitted integration API**.

Additional issues: cross-origin iframes, Shadow DOM, SPA navigation, CSP, browser extensions being blocked by administrators, system-specific adapters, model hallucination, prompt injection, consent to audio recording, medical confidentiality, Swiss nDSG / GDPR as applicable, external processors, retention and incident response.

Fail closed rather than guessing identity or treating a success-looking HTML response as proof of persistence. Prefer stable official vendor APIs when available.

## Publishing checklist

Run `npm test && npm run audit:publish`. Inspect `git ls-files` before publishing. Never commit tokens, session snapshots, HAR files, customer information or proprietary screenshots. If credentials were ever committed, remove them from history and rotate them before sharing; .gitignore alone is insufficient.
