# Instagram Login real-account acceptance

Verified on 2026-10-14 UTC (2026-10-15 Europe/Zurich).

## Meta configuration

- Existing Meta app: Owl Lab (1179522658356836).
- Instagram app: Owl Lab-IG (1676955967433990).
- Instagram API with Instagram Login; no Facebook Page or additional app created.
- Only instagram_business_basic and instagram_business_content_publish added.
- HTTPS redirect: https://yh9cjtolx6.execute-api.eu-central-1.amazonaws.com/oauth/instagram/callback
- bloomroom.lab tester invitation sent to the exact resolved account and accepted by its owner.
- App remains unpublished; own-account testing uses Standard Access. Supporting unrelated users requires the applicable review and Advanced Access.

## Live result

- Existing local record: b0722f03-61b4-4149-ac6e-ae304a91b13c.
- Username: bloomroom.lab.
- Instagram professional user ID: 17841422480545932.
- Account type: MEDIA_CREATOR.
- Status: ready; account count remains 2, with no duplicate Instagram record.
- Long-lived token stored using Electron safeStorage. App Secret is separately encrypted and tied to the Instagram App ID.
- Token expiration: 2026-12-13T22:03:29.986Z.
- Official read-only content_publishing_limit returned quota_usage=0, quota_total=100, quota_duration=86400.
- No media container, public post, Reel, or Story was created.
- No Access Token was printed or committed.
- Security exception: the initial Meta UI snapshot unintentionally included the App Secret. The owner explicitly chose to retain the current secret and connection instead of rotating it. The exposure remains unresolved; no secret value is included in this report.

## Verification

- Desktop Instagram and YouTube OAuth/vault tests: 24 passed.
- Desktop build and git diff --check passed.
- Cloud Instagram relay tests: 2 passed.
- Deployed relay: readiness 200; missing state 400; synthetic valid callback 303 to hardcoded 127.0.0.1.
- Deployed API Gateway stage has no access-log configuration. Relay exchanges or stores no tokens; source has no request query logging.
- State mismatch rejected; first callback accepted; replay rejected; denied consent and timeout close the listener.
- YouTube original encrypted grant digest unchanged. A refresh request and authenticated channels query both returned 200 and verified channel UCDsmeB0wRkMrQiBDCdhdwPw. Diagnostic access token stayed in process memory; stored grant was not changed.

## Changes

- Require complete granted scopes and a professional account type before ready.
- Normalize a single wrapped profile response and use the professional user_id for publishing; preserve OAuth-scoped and app-scoped IDs separately.
- Verify content-publishing capability with a read-only API call before storing ready.
- Validate Meta App Secret format before saving or opening OAuth.
- Return only fixed error categories, never Meta response bodies.

## Remaining publishing work

The current UI intentionally says publishing inactive. OAuth readiness is not a completed automatic publisher.

- Implement publicly reachable media hosting/validation, media container creation, processing-status polling, media_publish, retry/idempotency handling and scheduling/approval integration.
- Meta supports JPEG photos, video, Reels and carousels under the requested publishing scope; OWL has not exercised their publication paths in this acceptance.
- Long-lived token refresh is not implemented in OWL yet. Meta supports GET /refresh_access_token with ig_refresh_token after the token is at least 24 hours old and before it expires. Until integrated, reconnect before expiry.
- Creator-account Story support is not claimed; validate the specific endpoint eligibility before implementing it.
- Keep App Secret and tokens in the local OS-encrypted vault; relay remains code-only.

## Official sources

- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started
- https://developers.facebook.com/documentation/instagram-platform/content-publishing
