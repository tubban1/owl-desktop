# Windows dual-MCP active/standby recovery — staged, NOT deployed

Windows Computer MCP listens on 127.0.0.1:8787. OWL MCP Win listens on 127.0.0.1:8790, and uses its local Runtime on 8788 and official Tunnel health on 18081. Each has its own ChatGPT tunnel. OWL DEV has an existing Guardian but it deliberately leaves Computer MCP untouched.

## New optional coordinator

The new scripts/windows/dual-mcp-guardian.ps1 is an independent local Windows recovery coordinator. Default mode Check is read-only. It is not installed just because the source code is merged.

- Check mode probes the expected service identity at each local /health endpoint, reports local runtime/tunnel separately, and explicitly refuses to infer remote ChatGPT connectivity from local health.
- Run mode requires one healthy independent MCP, 3 consecutive failed probes of the other, and 10 minutes cooldown. Recovery only starts an existing verified Scheduled Task for the failed target. It never kills processes, changes ports or credentials.
- The coordinator refuses to start when the target port is occupied but unresponsive or when the required restart task is not known or fails ownership checks.
- Install mode requires both existing trusted restart tasks and both local MCPs healthy, before creating an opt-in limited per-user logon task. Uninstall mode removes only the dual-MCP coordinator task.
- Logs metadata without secrets. A successful restart request is not itself proof the tunnel or ChatGPT session recovered.

## Check and rollout

On Windows, inside owl-desktop repository:

    powershell.exe -NoProfile -File scripts/windows/dual-mcp-guardian.ps1 -Mode Check

The legacy Computer MCP recovery Scheduled Task has not yet been confirmed on that machine. The script refuses Install unless a separately provisioned, owner-checked Computer MCP task and the existing OWL Guardian both exist. Do not invent a launcher or start by changing currently running tunnels.

## Remaining live acceptance (not completed)

1. Inventory legacy Computer MCP's process owner, Windows startup path and tunnel readiness. Register an independently managed least-privilege recovery task only after its command and credentials are verified.
2. Check local 8787/8790 plus each independent tunnel from Windows and tool discovery from ChatGPT.
3. With one service still usable, deliberately interrupt the *other* single service and ensure auto recovery, tunnel reconnection, no duplicates and no replay; test each direction separately.
4. Refuse and surface hung/occupied-port failures without killing healthy or ambiguous process ownership.
5. To survive actual Windows sign-out or restart before user login, migrate each background service to suitable SCM service identities with separate protected credentials, then physically test sign-out/reboot.
6. A single Windows machine, NIC, electricity, Internet or OpenAI control plane remains a common failure domain. Two local MCPs do not guarantee always-available remote access, and a ChatGPT Session terminated error does not prove either local MCP crashed.

## Current evidence

5 safety-contract tests have passed. Windows production installation, local PowerShell runtime behavior, restart fault injection and end-to-end reconnection have not been verified.
