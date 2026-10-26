# Windows OWL LAB development: direct MCP tunnel

## Intended data path

ChatGPT custom MCP plugin -> OpenAI Secure MCP Tunnel (Windows-specific tunnel ID) -> Windows OWL Desktop local MCP on `http://127.0.0.1:8790/mcp` -> local Runtime on `127.0.0.1:8788`.

The connection is directly initiated by ChatGPT and handled by the Windows device. **OWL Cloud RemoteCommand, Worker and task publishing are not prerequisites for this data path.** Cloud account enrollment and signed execution lease may still be used for identity and authorization. The Windows and Mac devices must each use their own tunnel ID and local MCP endpoint.

## Dev commands

1. Start the Windows checkout with `npm.cmd run dev:windows` and verify OWL's MCP at `http://127.0.0.1:8790/health`. Vite is localhost:5173 and Runtime is localhost:8788.
2. The OpenAI control-plane API key is placed in a CurrentUser DPAPI-encrypted file at `%APPDATA%\OWL LAB\dev\openai-tunnel-control-plane-key.dpapi`, with inheritance removed and owner-only ACLs. Never commit a key, store it in a new plaintext config, or put it on a command line.
3. Launch from PowerShell:

   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/dev-direct-mcp-tunnel.ps1 -TunnelId tunnel_<your Windows tunnel id>`

   This script tests the local MCP health first, then starts a separate official `tunnel-client.exe` with loopback health port 18081 and target 8790. It does **not** terminate or modify the old Computer MCP tunnel on 8787.
4. Verify the new tunnel client health and its control-plane readiness before adding the exact same tunnel ID as a custom MCP server in ChatGPT. Use **Tunnel** connection type, not Server URL; the Tunnel ID is not an HTTP URL.

## Error handling

- `OWL_WINDOWS_LOCAL_MCP_8790_NOT_LISTENING_ON_LOOPBACK`: Windows Desktop is down; start or repair it first. Check for a Vite watcher crash on temporary `*.~tmp` asset files.
- `OWL_WINDOWS_TUNNEL_ENCRYPTED_KEY_REQUIRED`: provision an API key for the chosen OpenAI organization to the Windows CurrentUser DPAPI file. Do not reuse another account's token.
- `OWL_WINDOWS_DIRECT_TUNNEL_ALREADY_RUNNING`: the same tunnel already has a client running; avoid duplicate sessions.
- ChatGPT `App configuration rate limited` is a *platform-side* response and is not proof of MCP reachability; wait for the platform's limit to expire and retry once after verifying a healthy tunnel. Repeated connector creation attempts can be counterproductive.
- ChatGPT may display authentication options; use no additional MCP auth only when the local OWL MCP has no bearer key and the Secure MCP Tunnel is the trusted entrypoint.
- A successful local TCP listener does not itself prove that an OpenAI control-plane tunnel is connected. Check `/readyz` on the tunnel client's own health port (18081) and perform tool discovery through ChatGPT.

## Safety

Do not alter any Mac tunnel, old Windows Computer MCP (8787), or its running tunnel. The dev script only reaches loopback MCP 8790, and keeps source tokens outside logs and Git. Existing Runtime authorization and user-approved action policies still apply.


## Windows native test gate

The general \`npm test\` command includes macOS-only launchd, Darwin Runtime
identity and POSIX mode/symlink tests. It is **not** a Windows release gate.
Use \`npm run verify:windows:dev\` on a fresh Windows checkout. This runs all
Windows-applicable tests (including the Chrome native messaging, upload
permissions, scoped approval, Windows Runtime, direct MCP and mail tests),
and prints the explicit list of macOS/POSIX-only suites it does **not** count
as passed.

A successful Windows gate is not equivalent to the complete macOS test
suite. macOS CI must still run \`npm test\`, and production readiness needs
the Windows device-specific Native Messaging round-trip and service health.
Windows Git checkout must honor \`.gitattributes\` LF for \`*.mjs\`,
particularly \`native-messaging-host.mjs\` with its importable shebang.
Before replacing a running checkout, always perform \`node --check\` of the
native host and renderer production build. A failed check must **not**
stop the existing Desktop.
