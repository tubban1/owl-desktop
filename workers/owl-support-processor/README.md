# OWL Support ticket lifecycle / ChatGPT 操作手册

## Architecture (2026-10-28)

Inbound: `agent@tbn.cc` -> Cloudflare Email Routing -> `owl-support-agent` -> D1 `owl-support-cases` + Gmail forwarding. **Existing inbound Worker is unchanged.**

Ticket lifecycle: authenticated Cloudflare D1 SQL connector (ChatGPT) or internal `owl-support-processor` Worker API -> D1 `support_cases`, `support_case_events`, `support_case_outbox`.

Outbound: `owl-support-processor` Cron every five minutes -> private Service Binding `owl-mailer` -> Brevo -> customer. The new Worker does **not** use Workers AI, and does not run LLM inference by itself.

System is designed for **human-initiated** ChatGPT handling: ChatGPT is not woken by inbound email. Upon user prompt such as “看看 support 邮件并处理”, the assistant must actively use Gmail + Cloudflare tools to execute the steps below. No invisible automation is implied.

## Cloudflare resources

- Account: `ad11834384e2af770b7aab87d7fc6d91`
- D1 ID: `ddcc953e-4ce4-4513-b802-c61729b84554` (name `owl-support-cases`)
- Worker: `owl-support-processor`, handlers `fetch`, `scheduled`
- Bindings: `SUPPORT_DB` (D1), `MAILER` (private Service Binding), `MAILER_CALL_TOKEN` (Secret), `SUPPORT_CASES_TOKEN` (Secret)
- Workers.dev public entrypoint: **off**
- The dispatcher does not send to arbitrary addresses. It requires recipient to equal the case's original sender and actor to equal assigned agent.
- Cron: `*/5 * * * *` UTC, Cloudflare may need up to 15 minutes to propagate schedule changes.

## States and audit trail

`received` or `human_review` -> `in_progress` -> `awaiting_customer` or `resolved` -> `closed`.
`resolved` / `closed` -> `reopened` -> `in_progress`.
Do not close without verification and a resolution summary. Escalate sensitive cases rather than applying automated changes without authorization.

D1 triggers automatically append audit events on **case creation**, **state changes**, **assignee changes**, **ack_status changes**, **outbox insertion** and **outbox delivery-status changes**. Additional **diagnosis**, **tool_action**, **investigation**, **verification**, **customer_feedback** notes must be explicitly appended by the assistant after completing each meaningful activity.

`support_case_events` fields: `id,case_id,event_type,actor,detail,from_state,to_state,request_id,created_at`. Never log passwords, tokens, raw customer files, or full private diagnostics in `detail`. Use short evidence references and redacted summaries.

`support_case_outbox` provides queue idempotency (`idempotency_key` unique). It holds the reply text privately in D1, plus its SHA-256 digest; the API does not return full body by default. Attempts become `prepared -> sending -> sent | rejected | uncertain`. **Never automatically retry uncertain delivery**. Confirm Gmail/provider records before deciding whether a retry is appropriate.

## ChatGPT workflow (Cloudflare and Gmail connectors)

When user requests “处理 Support 邮件”:
1. Search the Gmail forwarding inbox for recent correspondence with `agent@tbn.cc` / `support-test@tbn.cc`. Read relevant messages and use sender/subject/received time to match each to D1. If correlation is ambiguous, pause and ask or mark for human review.
2. Read D1 pending cases via authenticated Cloudflare D1 query: `SELECT id,sender,subject,state,assigned_to,version,created_at FROM support_cases WHERE state IN ('received','human_review','reopened','in_progress','awaiting_customer') ORDER BY created_at LIMIT 50`.
3. Claim a case using the private API `POST /v1/cases/:id/claim` from an authorized internal Worker; or use Cloudflare D1 parameterized SQL via connector:
   `UPDATE support_cases SET assigned_to='chatgpt',state='in_progress',version=version+1,last_action_at=datetime('now'),updated_at=datetime('now') WHERE id=?1 AND state IN ('received','human_review','reopened') AND assigned_to IS NULL`.
   Inspect update result for one affected row; otherwise do not claim success. Trigger creates state/owner events.
4. Read original email, relevant OWL diagnostics / account authorization data. **After each substantial action**, append a D1 event:
   `INSERT INTO support_case_events(id,case_id,event_type,actor,detail,request_id) VALUES (?1,?2,'diagnosis','chatgpt',?3,?4)`, with fresh UUID and unique request ID. Suggested types: `investigation`, `diagnosis`, `tool_action`, `verification`, `escalation`, `human_note`.
5. Prepare a recipient-verified reply; send **only through the D1 outbox**, not Gmail's generic authenticated sender, to ensure `agent@tbn.cc` sender plus atomic outbox audit.
   Compute SHA-256 hex of the exact reply body; insert an outbox row:
   `INSERT INTO support_case_outbox(id,case_id,idempotency_key,recipient,subject,body_sha256,status,actor,body_text,reply_to) VALUES (?1,?2,?3,?4,?5,?6,'prepared','chatgpt',?7,'agent@tbn.cc')`.
   Recipient **must exactly equal** `support_cases.sender`; validate case ownership; never create duplicate idempotency keys on retries.
6. Worker Cron sends within the next scheduled cycle via `owl-mailer`. Check `support_case_outbox.status`, `provider_message_id` and automatic `reply_sent` / `reply_uncertain` / `reply_rejected` events. If delivery is uncertain, do not claim it was sent.
7. Mark `awaiting_customer`, `resolved`, or `human_review` using an authorized transition, and append a reason event. Verify customer feedback or independent diagnostic evidence before `closed`, then fill `resolution_summary` and `closed_at`.
8. Report to the user which cases were inspected, replied to, resolved, escalated, or remain awaiting confirmation; include IDs and avoid claiming any unconfirmed delivery.

Each D1 query uses:
`POST /accounts/{account_id}/d1/database/{database_id}/query` with `{"sql":"... ?1 ...","params":["..."]}` using the connected Cloudflare client; do not interpolate untrusted email content into raw SQL.

## Internal API (private Service Binding)

`owl-support-processor` exposes an authenticated fetch handler **only** to other explicitly bound Cloudflare Workers. Header `Authorization: Bearer <SUPPORT_CASES_TOKEN>` is required; the token is not available to chat or git.

- `GET /v1/cases?state=received&limit=20`
- `GET /v1/cases/:id` (case, events, outbound metadata)
- `POST /v1/cases/:id/claim` `{actor,requestId}`
- `POST /v1/cases/:id/events` `{actor,requestId,type,detail}`
- `POST /v1/cases/:id/transition` `{actor,requestId,to,summary?,verified?,detail?}`
- `POST /v1/cases/:id/reply` `{actor,requestId,subject,text}` -> queues and returns outbox ID

`requestId` is an idempotency key. Claim/transition use optimistic version checking; duplicate replies with the same key and content return the existing outbox row; a changed payload under the same key is rejected.

ChatGPT's **current** connector uses D1 SQL; the private internal HTTP API is for later direct OWL LAB MCP binding. Do not claim ChatGPT has a native `support_case` tool until that tool is registered in the connector.

## Operational safeguards

- Do not automatically read or mutate customer machines without explicit authorization.
- For complaints, security, legal, financial data, or privacy-sensitive issues, mark `human_review` and notify the account owner.
- Avoid storing credentials in events, outbox body, app logs, source code or Git. Keep diagnostics redacted.
- Do not mark 'sent' based only on the outbound queue insert. Brevo acceptance isn't identical to recipient inbox delivery.
- Keep the Gmail original for audit; metadata is in D1.
- Cloudflare Free capacity is shared by all Workers; the Cron adds scheduled invocations. Monitor D1 quotas and Worker errors.
- Add retention policy, support dashboard, stronger multi-actor identity/access control, and automated notifications if volume grows.

## QA

`node --test test/workflow.test.mjs`: six unit cases cover access control, input filters, non-matching recipient prevention, successful Brevo acceptance and uncertain transport. Full live queue test is recorded separately in D1 under QA ticket ID `CASE-E2E-20261028-OWL-SUPPORT-V1`.
