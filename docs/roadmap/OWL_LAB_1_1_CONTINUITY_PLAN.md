# OWL LAB 1.1 — Continuity

Status: active implementation plan.

## Release line

OWL LAB 1.0 is the internal foundation baseline. OWL Runtime 1.0.0 keeps the
frozen execution contract and accepts bug fixes only.

OWL LAB 1.1 is the first intended public product release.

The 1.1 theme is **continuity**:

> Planner transport may change; durable work and recoverable planning state do
> not disappear with one ChatGPT conversation.

Runtime 1.0 is not reopened for Conversation Continuity product features.
Desktop/MCP consumes existing Runtime facts and files a Runtime contract request
only when a required fact is genuinely unavailable.

## Serialized implementation order

1. **Continuity Foundation**
   - durable Planner Handoff records;
   - bounded Resume Capsule;
   - `conversation_handoff_prepare`;
   - `conversation_handoff_latest`;
   - `conversation_handoff_get`;
   - `conversation_handoff_consume`;
   - resume the existing workstream instead of creating replacement work.

2. **Context Meter / Session Guard**
   - measure OWL-observed MCP traffic only;
   - growth rate, repeated payload ratio, session age, tool-call count,
     checkpoint staleness and active durable work;
   - emit LOW / MEDIUM / HIGH / CRITICAL;
   - never claim OpenAI's actual remaining context tokens.

3. **Fail-safe preparation**
   - HIGH prepares a handoff before user notification;
   - CRITICAL refreshes the capsule when materially stale;
   - tool responses may carry small continuity metadata;
   - no attempt to inject unsolicited messages into ChatGPT UI.

4. **Desktop product UI**
   - Conversation Continuity card;
   - Handoff Ready state;
   - Copy Resume Prompt;
   - observed-context growth visualization;
   - source-of-growth breakdown.

5. **Recovery hardening**
   - Chat A -> Chat B cross-session acceptance;
   - Tunnel disconnect / reconnect;
   - renderer restart;
   - Runtime restart with durable Task survival;
   - no duplicate Task submission or workspace takeover.

## 1.1 release gate

The release candidate is not complete until this scenario passes end-to-end:

```text
Chat A
  -> active workstream
  -> durable Runtime Task
  -> continuity risk HIGH
  -> handoff prepared
  -> Chat A ends
Chat B
  -> conversation_handoff_latest
  -> resume original workstream
  -> inspect original Runtime Task
  -> do not create replacement Task
  -> continue and complete
  -> consume handoff
```

The Monitor must show the same logical work across the planner transition.

## Non-goals

- scraping the ChatGPT UI;
- claiming exact ChatGPT context-window utilization;
- storing full conversation transcripts;
- copying Runtime execution authority into Desktop;
- reusing Runtime Workspace Handoff terminology for planner continuity.

## Implementation checkpoint — 2026-10-02

Completed in the current Desktop source tree:

- Planner Handoff durable store, backward-compatible with existing planner-continuation V1 state;
- bounded Resume Capsule with decisions, constraints and do-not-repeat context;
- conversation_handoff_prepare/latest/get/consume;
- conversation_continuity_status;
- cross-owner Chat A -> Chat B MCP E2E that resumes the same workstream;
- OWL-observed traffic meter using sanitized payload length + SHA-256 digest only;
- explainable LOW / MEDIUM / HIGH / CRITICAL risk model;
- HIGH/CRITICAL fail-safe auto-preparation before the progress-boundary notice;
- Monitor Conversation Continuity card, Handoff Ready and Copy Resume Prompt;
- controlled dev:full restart with Runtime, Connection Host, Tunnel and Desktop recovery;
- live MCP surface confirms all five Conversation Continuity tools are exposed.

Acceptance reached during this checkpoint:

    Desktop full gate: 45/45 test files, 201/201 tests PASS
    Continuity compatibility targeted gate: 4/4 files, 12/12 tests PASS
    TypeScript + Vite build: PASS
    git diff --check: PASS
    live dev:full startup verification: PASS
    ChatGPT -> Tunnel -> Connection Host -> Runtime after restart: PASS
    real Session A -> Session B Planner Handoff dogfood: PASS

The first human dogfood handoff completed on 2026-10-02. A fresh Chat received
only "继续 OWL LAB", recovered the existing OWL LAB workstream, consumed the
durable handoff and continued without replacement Runtime Tasks or repository
context restatement.

### Remaining 1.1 hardening discovered by dogfood

1. Real Chat source identity — resolved in dogfood
   - live dogfood proved that a headerless ChatGPT/Tunnel path could fall back
     to the shared Desktop session and make two Chats appear to be one planner;
   - headerless remote MCP sessions now derive a stable planner owner from the
     real MCP transport session, so distinct Chats stay isolated while one
     transport/reconnect keeps the same owner;
   - the persistent Desktop fallback is now reserved for requests explicitly
     labelled with x-owl-client-kind: desktop;
   - regression coverage includes two independent headerless MCP sessions and
     same-session stability.

2. Actual ChatGPT A -> B dogfood — PASS
   - a fresh Chat was opened with only: 继续 OWL LAB;
   - the live MCP server exposed 96 tools including all dedicated Continuity
     tools, but the already-open ChatGPT conversation retained a cached older
     connector tool catalog;
   - to remove any user-facing "refresh tools" dependency, get_capabilities now
     returns bounded conversationContinuity bootstrap metadata and the existing
     stable skill_run surface supports owl.continuity.status/latest/prepare/resume;
   - the fresh Chat discovered handoff_mur3mmpu_84ff6369c1de through
     get_capabilities, resumed through skill_run(owl.continuity.resume), rebound
     to owl-owner:2f1f69f3c2fdb11a9a7e5389564f6d82 and consumed the handoff;
   - post-resume state reported readyHandoffCount=0, latestReadyHandoff=null,
     clientKind=chatgpt, ownerSource=workstream-binding and one connected planner
     transport;
   - no replacement Runtime Task was created.

3. Risk calibration
   - current V1 scoring is intentionally explainable and conservative;
   - calibrate thresholds from dogfood telemetry without claiming OpenAI private
     context-window state.

Package/application version remains development 0.1.0 until the 1.1 release
gate is complete. The first intended public product version remains 1.1.0.


## Non-interactive execution before Browser UI

OWL planning must choose the least interactive reliable execution path. For
software-development and deployment services (for example Vercel, GitHub, AWS
and Cloudflare), prefer in this order when available:

1. a dedicated connected tool;
2. authenticated API;
3. CLI using credentials already present in the project environment;
4. managed Browser UI only when the user explicitly requests UI work or the
   non-interactive path has been verified unavailable.

Credential discovery must not print secret values. A browser dashboard or login
page must not be opened merely because browser capability is available.

This rule was added after dogfood unnecessarily opened Vercel's create-project
UI even though the target project already had Vercel credentials in its local
environment.
