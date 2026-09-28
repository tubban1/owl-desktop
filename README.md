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
- [Runtime Consumer Contract](docs/contracts/RUNTIME_CONSUMER_CONTRACT_V1.md)
- [Cloud Bridge Contract](docs/contracts/CLOUD_BRIDGE_CONTRACT_V1.md)
- [Platform Integration](docs/integration/PLATFORM_INTEGRATION.md)
- [2.0 Dependency Roadmap](docs/roadmap/2.0-dependency-roadmap.md)
