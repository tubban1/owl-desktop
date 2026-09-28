# OWL Platform Integration

Status: **Normative integration model**.

OWL Runtime does **not** centrally integrate the entire platform.

Integration has three authorities:

1. **OWL Runtime** — execution authority
2. **OWL Cloud** — identity/control authority
3. **OWL Desktop** — local product integration host

OWL Worker is an optional product UX consumer.

## Local integration

```text
ChatGPT
  ↓
OWL MCP
  ↓
RuntimeClient
  ↓
OWL Runtime
  ↓
Providers
```

OWL Desktop owns the E2E integration test for this path.

Runtime owns conformance of the execution contract; Desktop owns compatibility with that contract.

## Cloud integration

```text
OWL Worker / future Mobile / Admin / API client
  ↓
OWL Cloud
  ↓
Remote Command
  ↓
OWL Cloud Bridge on Desktop
  ↓
RuntimeClient
  ↓
OWL Runtime
  ↓
Result / Observation / Receipt
  ↓
Cloud projection
```

Cloud owns the command lifecycle before Runtime acceptance.

Cloud organization roles and DeviceGrants authorize whether a request may be sent. Desktop consumes effective access according to [Cloud Access Consumer Contract v1](../contracts/CLOUD_ACCESS_CONSUMER_V1.md); it must not turn Cloud roles into Runtime capabilities.

Runtime owns execution after acceptance.

Cloud stores projections/indexes, not a second execution truth.

## Integration gates

```text
Contract Freeze
  ↓
Provider Conformance
  ↓
Consumer Compatibility
  ↓
Local E2E
  ↓
Cloud E2E
  ↓
Dogfood
  ↓
Soak
  ↓
Production
```

## Cross-repo rule

No repo may fix an integration gap by copying another repo's canonical subsystem.

Instead create a Contract Request in the owning repo with:

- missing semantics
- blocking consumer
- acceptance test
- compatibility impact
- desired contract version

## Compatibility matrix

OWL Desktop is the canonical local place to publish the tested combination:

```text
OWL Desktop version
↔ OWL Runtime API version
↔ OWL Cloud API version
↔ OWL Tunnel protocol version
```

Worker compatibility is published separately because Worker is not required for local execution.
