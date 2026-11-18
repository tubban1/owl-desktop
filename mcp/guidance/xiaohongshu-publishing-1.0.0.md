# Xiaohongshu publishing — v1.0.0

**Purpose:** Agent guidance for a Xiaohongshu creator-platform post. This is **not** an executable Skill, a permission grant, or a second Runtime Skill Registry. It may be reused by other workflows.

## Before any execution

- Confirm account, selected video/images, the material's origin and rights, audience, intended visibility, and approved title/body. Do not claim capabilities that the media does not show.
- Prefer concise Chinese copy, useful cover, relevant selected topics; inspect actual available controls rather than assuming the website layout or rule text.
- Consult `ai-content-disclosure` for original-content eligibility and AI generation labeling. Never automatically tick an originality assertion; absence of a control is not confirmation of a declaration.
- Confirm user authority to submit. OWL Runtime remains the only execution/authorization authority.

## Current OWL Runtime adapter: xhs.publish

The built-in Runtime Skill has phases, not a trustworthy fire-and-forget posting result.

1. `phase=prepare`, `publish=false`: navigate and set the image/video file input. The current creator page initially opens on the video upload screen; its title/body fields appear later. Result `UPLOAD_REVIEW_REQUIRED`, **not** proof that upload/transcode completed. Image mode requires a separate current-page tab choice and remains unverified by live upload testing.
2. `phase=fill`, `publish=false`: only after observing upload completion and the actual editor, enter title/body without re-uploading or navigating. If inputs are not ready, return `UPLOAD_REVIEW_REQUIRED` and inspect again.
3. `phase=inspect`, `publish=false`: read the current page and obtain `reviewDigest`. Inspect upload completion, title/body, selected topics, cover, account, originality and AI disclosure. If the UI changes, use authorized browser tools to inspect and adapt. Re-inspect after any change.
4. `phase=submit`, `publish=true`, with the latest `reviewDigest`: only after all required checks are true (`formReviewed`, `mediaReady`, `rightsVerified`, `aiDisclosureReviewed`). A stale or unrecognized page must block submission. Review flags are attestations, not machine proof.
5. `phase=reconcile`: read-only inspection after submit. Current adapter cannot prove public visibility. Use creator work-management or public URL evidence before reporting platform acceptance/publication; otherwise **SUBMISSION_UNCERTAIN**.

**Critical:** A click, text saying “发布成功”, or a changed URL is not proof that a work is publicly visible. Never change `submissionKey` merely to retry. After any uncertain submit, inspect the previous attempt and work list before considering a new post. `published: false` and `SUBMISSION_UNCERTAIN` are expected safe results when proof is lacking.

## Evidence & reporting

Separate `UPLOAD_REVIEW_REQUIRED`, `FORM_REVIEW_REQUIRED`, `BLOCKED`, `SUBMIT_ATTEMPTED`, `SUBMISSION_UNCERTAIN`, `PLATFORM_ACCEPTED`, and `PUBLIC_VERIFIED`. The last two require provider-specific independent evidence, not a checkbox assertion. Record URL, account, content identity, timestamp, exact guidance version/digest, Runtime Skill version, and evidence; the first iteration does not yet implement independent public-post confirmation.

If upload, selector, unexpected dialog, or declaration check fails, stop with evidence and request an Agent review at that checkpoint. Do not silently skip or auto-retry consequential steps.
