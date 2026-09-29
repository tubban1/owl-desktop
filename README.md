# OWL Desktop

OWL Desktop is the local product shell for the OWL platform.

It integrates:

- **OWL MCP** — ChatGPT / MCP compatibility adapter
- **OWL Control** — local settings, logs, sessions, health, approvals
- **Identity & Session Vault** — local external-service account/session management
- **OWL Tunnel** — secure remote transport
- **OWL Cloud Bridge** — control-plane synchronization
- **OWL Helper / Runtime Host** — stable macOS native identity and permissions
- **OWL Runtime** — consumed as an external execution authority

OWL Desktop does **not** reimplement Task, Process, Scheduler, Verification, Approval enforcement, Workspace ownership, or recovery semantics owned by OWL Runtime.

## Short-term primary path

```text
ChatGPT
  ↓ MCP
OWL Desktop / OWL MCP
  ↓ RuntimeClient
OWL Runtime
  ↓
Mac / Browser / Files / Apps
```

Cloud and Worker are optional for local execution.

See:

- [Ownership](docs/architecture/OWNERSHIP.md)
- [Cross-Repo Development Protocol v1](docs/architecture/CROSS_REPO_DEVELOPMENT_PROTOCOL_V1.md)
- [Runtime Consumer Contract](docs/contracts/RUNTIME_CONSUMER_CONTRACT_V1.md)
- [MCP Bridge Contract](docs/contracts/MCP_BRIDGE_CONTRACT_V1.md)
- [Identity & Session Vault v1](docs/contracts/IDENTITY_SESSION_VAULT_V1.md)
- [Runtime Host + Tunnel Consumer v1](docs/contracts/RUNTIME_HOST_TUNNEL_CONSUMER_V1.md)
- [Cloud Bridge Contract](docs/contracts/CLOUD_BRIDGE_CONTRACT_V1.md)
- [AgentRequest v1](docs/contracts/AGENT_REQUEST_V1.md)
- [Agent Inbox M1 Status](docs/integration/AGENT_INBOX_M1_STATUS.md)
- [Cloud Bridge M1 Status](docs/integration/CLOUD_BRIDGE_M1_STATUS.md)
- [Desktop → Cloud Contract Requests](docs/contracts/DESKTOP_CLOUD_CONTRACT_REQUESTS.md)
- [Compatibility Matrix](docs/contracts/COMPATIBILITY_MATRIX.md)
- [Platform Integration](docs/integration/PLATFORM_INTEGRATION.md)
- [Platform Integration Gates v1](docs/integration/INTEGRATION_GATES_V1.md)
- [Local E2E Status](docs/integration/LOCAL_E2E_STATUS.md)
- [Skill Manager v1](docs/skills/SKILL_MANAGER_V1.md)
- [Skill Manager Implementation Status](docs/skills/SKILL_MANAGER_IMPLEMENTATION_STATUS.md)
- [macOS Distribution](docs/integration/MACOS_DISTRIBUTION.md)
- [2.0 Dependency Roadmap](docs/roadmap/2.0-dependency-roadmap.md)

## Development

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

OWL Desktop development connects to OWL Runtime at `http://127.0.0.1:8788` by default and embeds OWL MCP at `http://127.0.0.1:8790/mcp`. These intentionally stay separate from the legacy production service currently using port 8787.

Run the Runtime development daemon separately:

```bash
cd ../owl-runtime
npm run start:source
```

Quality gates:

```bash
npm test
npm run build
npm run verify:local-e2e
npm run verify:cloud-bridge-live
npm run verify:agent-inbox-e2e
```

The Local E2E verifier expects Runtime to allow the target repository through `ALLOWED_DIRECTORIES`.

The Electron renderer has no Node integration. Runtime credentials and project secrets remain in the Electron main process and are persisted only through OS-backed encryption.