# OWL Computer Use: browser selection and agent-owned tabs

## Selecting the correct tool

When a user asks OWL to **edit a website** (such as updating their Reddit profile), a separate ChatGPT Browser connector may expose read-only tab data; do not conclude that OWL itself cannot write.

1. Query OWL `provider_status` or `get_capabilities` for the managed Browser and Desktop provider status.
2. Prefer the official site/API integration when it supports the requested action safely, otherwise use **OWL** `browser_open` + `browser_snapshot` + `browser_type`/`browser_click`. Do not use read-only Browser connector methods as if they can save.
3. OWL Browser uses a separate persistent Chrome profile. If the user has only logged in to personal Chrome, explain that they must log in to the OWL-managed profile or explicitly authorize a future attached-tab feature. Do **not** copy cookies or attach a personal profile silently.
4. Take `browser_screenshot` after changes and verify the saved value through fresh page content or a targeted check. Do not claim a successful external mutation from click/typing alone.
5. Prefer `tab_id` from `browser_list_tabs` for `browser_use_tab`; indices can change when other tabs close. A `tab_id` is not an ownership token; Runtime still refuses cross-owner tabs.

## User noninterference

In compatible OWL Runtime versions, actions and screenshots address the caller's agent-owned Playwright Page even while the human browses in a different tab. Selecting a tab logically does not call `bringToFront`. Closing an owner tab does not end unrelated sessions. If Runtime doesn't support isolated tabs or stable IDs, report reduced capability rather than claiming noninterference.

## Still planned

- Explicitly consented attachment to user's existing signed-in Chrome tab, with per-site write grants.
- Durable owner handoff across transport/session rotation, not merely a stable Chrome `tabId`.
- First-class multi-step edit/verify workflow with resumability and auditable receipts.

These follow-ups must preserve Runtime authorization, side-effect approval and verification requirements.
