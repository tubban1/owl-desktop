# MCP Native Image Delivery

Use read_image to send an authorized existing local JPEG, PNG, WebP or GIF
as a native MCP ImageContent block rather than shell Base64 text.

Security: first authorize with Runtime fs.stat/get and ALLOWED_DIRECTORIES,
then check canonical realpath, metadata, bounded regular-file open with
O_NOFOLLOW, magic-byte MIME and maximum 4 MiB transfer size.
No image binary or Base64 goes into telemetry or continuity records.
No network file hosting, uploads, or modification.

This is an MCP inline image for supporting clients, not a persistent
ChatGPT conversation file attachment. The user interface must confirm it
was rendered; server-side image bytes alone do not establish UI success.

Tests: npx vitest run tests/mcp-native-image.test.mjs
The tests exercise a real Streamable HTTP MCP client and assert ImageContent.
