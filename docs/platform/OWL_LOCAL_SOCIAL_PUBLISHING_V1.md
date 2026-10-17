# OWL LAB Desktop — Local-First Social Publishing V1

## Ownership and data movement
- Media bytes originate on the user's device. A publisher must never send them through OWL Cloud file delivery, S3, Cloud MCP or any central temporary object store.
- Platform OAuth tokens remain encrypted in local OS storage, never exposed through renderer IPC or printed.
- Cloud device enrollment is not a prerequisite for local social publishing.
- Publishing is irreversible: log account/media/caption identity; no automatic retry after uncertain remote upload or publish results.

## Platform transports
- **YouTube:** Desktop → YouTube Data API videos.insert resumable upload. OAuth connectivity exists, but an actual uploader is not implemented yet.
- **Instagram:** Instagram Login uses Meta's video_url workflow. Direct binary resumable Reel upload (Desktop → rupload.facebook.com) is documented for Facebook Login for Business. Do not exchange these grant types. The new direct upload adapter requires an explicit Facebook Login for Business grant and fails closed with Instagram Login credentials.
- **Douyin and Xiaohongshu:** planned Computer/Browser Use adapters choose local files using the native platform upload form. Neither requires OWL Cloud media staging.

## Implementation status — 2026-10-15
- Local Meta binary transport and idempotency journal implemented and mock-tested.
- Existing @bloomroom.lab Instagram Login remains connected and stored; it does not authorize the binary transport.
- UI accurately disables incompatible direct publishing. Facebook Login for Business OAuth, Page selection and grant verification must be implemented before enabling it.
- No live Instagram publication is claimed.

## Guardrails
- Never silently restore OWL Cloud/S3 staging.
- Never expose a local video publicly without explicit authorization, tightly scoped delivery, expiry and ingress security controls.
- Never switch to Browser Use behind the user's back or reuse an unrelated OAuth token.
