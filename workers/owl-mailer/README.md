# OWL Mailer

Independent private Cloudflare Worker for transactional email via Brevo. Not an AI agent. Mail receiving remains in Cloudflare Email Routing and the existing `owl-support-agent` Email Worker.

## Status / onboarding

Cloudflare `owl-mailer` was deployed 2026-10-28, with workers.dev disabled. `owl-support-agent` has a private Service Binding `MAILER` targeting `owl-mailer` and shares a distinct `MAILER_CALL_TOKEN` secret with it. Production sending cannot be considered active until the *new* `owl-mailer` Worker also has `BREVO_API_KEY` and an end-to-end delivery test passes. The pre-existing `BREVO_API_KEY` bound to `owl-support-agent` cannot be read or copied using Cloudflare API.

To enable: Cloudflare dashboard -> Workers & Pages -> owl-mailer -> Settings -> Variables and Secrets -> Add secret `BREVO_API_KEY` with the same Brevo API key (do not paste into chats, git or CI logs).

## Internal API

Service-to-service calls from an authorized Worker (not public HTTP):

```js
const response = await env.MAILER.fetch("https://owl-mailer.internal/v1/send", {
  method: "POST",
  headers: {
    "authorization": "Bearer " + env.MAILER_CALL_TOKEN,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    from: "agent@tbn.cc",
    to: ["approved-recipient@example.org"],
    subject: "OWL LAB: support update",
    text: "Example message"
  })
});
```

`GET /health` reports readiness (only accessible through Service Binding). `POST /v1/send` enforces secret-token authentication, sender allowlist, recipient and body validation, maximum 5 recipients, max 110 KB request body; calls Brevo transactional API. Provider credentials and email bodies are not logged. A transport timeout has uncertain delivery; do not blindly retry.

Add further approved sender addresses to `MAIL_FROM_ALLOWLIST` after validating them with Brevo. Do not expose a public HTTP route without a separate authorization/rate-limit/security review.

## Reliability and security

Production hardening before broad transactional rollout: durable idempotency, queue + dead-letter handling, per-caller quotas, outbound audit trail with redacted metadata, documented allowlist changes, and incident monitoring. This initial release intentionally does not provide those features.

**No secrets in source control.** Secret bindings must be provisioned per Worker.
