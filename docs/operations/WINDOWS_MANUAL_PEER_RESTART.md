# Windows MCP manual mutual restart

Scope: restart **only the other Windows MCP** on user request while Windows is running. No additional watchdog, Windows Service or always-on recovery process is installed.

The independent channels are Computer MCP (localhost:8787) and OWL MCP Win (localhost:8790, Runtime 8788), each with its own ChatGPT tunnel.

## Computer MCP repairs OWL

From Computer MCP's authorized shell in the installed owl-desktop working directory:

    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/windows/manual-peer-restart.ps1 -Mode Check
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/windows/manual-peer-restart.ps1 -Mode Restart -Target Owl -Component Server

The script refuses if Computer MCP local health fails, or if the `OWL LAB DEV Guardian` task or exact OWL-owned Electron listener cannot be verified. It stops only the matching Electron process and relies on the existing OWL Guardian to start OWL again. Stage and validate updated code **before** restart. OWL's independent tunnel is not terminated.

## OWL repairs Computer MCP

Use `windows_computer_mcp_status` first. To repair a broken *ChatGPT connection* with healthy local Computer MCP choose `windows_computer_mcp_restart(component="Tunnel",confirmation="restart-peer-computer-mcp")`. If local Computer MCP server is down use `component="Server"`. The OS operation is narrowly implemented inside the OWL Desktop capability bridge, not exposed as a generic shell action. Verify Computer MCP tool discovery with a fresh read-only call after restart.

The Windows restart script requires independently owned, already-running Windows Scheduled Tasks named `Computer MCP Runtime` and `Computer MCP Tunnel`. If missing or disabled, it **fails closed**; it never kills an unknown process or manufactures an arbitrary launcher. These two Computer MCP tasks have not yet been confirmed on the live Windows machine, so **the feature is not operationally accepted yet**.

## What remains

1. When either Windows tunnel returns, read-only inventory of Computer MCP's actual server/tunnel process owner and launcher; establish verified recovery tasks or adapt the fixed allow-list to its true existing names. Do not modify unrelated process or credentials.
2. Validate one-at-a-time restarts from *the other* live MCP and a real ChatGPT reconnection, rather than counting a local health check as remote success.
3. This does not protect against Windows power loss, sleep, sign-out or a shared network/ChatGPT service outage. No two local plugins on one machine can promise that.

The earlier dual-MCP Watchdog was not installed, and this feature does not install it.
