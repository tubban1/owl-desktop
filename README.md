# OWL Desktop

OWL Desktop is the local product shell for the OWL platform.

It integrates:

- **OWL MCP** — ChatGPT / MCP compatibility adapter
- **OWL Control** — local settings, logs, sessions, health, approvals
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
- [Cloud Bridge Contract](docs/contracts/CLOUD_BRIDGE_CONTRACT_V1.md)
- [Compatibility Matrix](docs/contracts/COMPATIBILITY_MATRIX.md)
- [Platform Integration](docs/integration/PLATFORM_INTEGRATION.md)
- [Platform Integration Gates v1](docs/integration/INTEGRATION_GATES_V1.md)
- [2.0 Dependency Roadmap](docs/roadmap/2.0-dependency-roadmap.md)

## Development

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

OWL Desktop development connects to OWL Runtime at `http://127.0.0.1:8788` by default. This intentionally stays separate from the legacy production service currently using port 8787.

Run the Runtime development daemon separately:

```bash
cd ../owl-runtime
npm run start:source
```

Quality gates:

```bash
npm test
npm run build
```

The Electron renderer has no Node integration. Runtime credentials and project secrets remain in the Electron main process and are persisted only through OS-backed encryption.
