# OWL LAB Desktop Information Architecture v1

Status: product UI contract for Desktop 1.0 DEV.

## Principle

The primary Desktop UI answers user questions, not subsystem questions.

A normal user should be able to answer:

1. Is OWL ready?
2. What is working right now?
3. Is the work persistent, observable and authorized?
4. Which devices can OWL use?
5. Does anything need my approval?
6. Which reusable Skills are installed?
7. Am I signed in and entitled?
8. What everyday settings can I change?

Internal coordination queues, transport sessions, Runtime projections and raw logs are advanced support surfaces.

## Primary navigation

### Home

Purpose: readiness + attention.

Shows:
- overall product readiness;
- current work summary;
- pending Runtime approvals when they exist;
- current workstream/background-work counts;
- Runtime authorization state;
- high-level connection health.

Does not expose raw AgentRequest history or raw diagnostics.

### Monitor

Purpose: live Agent Operations.

Shows:
- dynamic real-time flow graph;
- Persistent / Observable / Authorized;
- actual MCP request/response traffic;
- current durable workstreams;
- protected approval boundaries when pending;
- next actions.

Historical Runtime/AgentRequest data must not masquerade as current work.

### Devices

Purpose: device identity, presence, authorization and capability.

Shows:
- active device registrations;
- current/offline state;
- authorization/lease state;
- privacy-bounded current usage;
- advertised capabilities;
- revoked/historical registrations under collapsed Device history.

The page is not a RemoteCommand test console.

There is no generic "Run test" product action. Remote work is initiated by ChatGPT, Worker, Cloud or another agent and observed in Monitor.

### Skills

Purpose: reusable execution capabilities.

Shows installed Skills, candidate lifecycle and explicit test/promotion flows.

### Account

Purpose: OWL LAB account identity and commercial authorization.

Primary content:
- signed-in state;
- device enrollment;
- entitlement;
- Runtime authorization.

External service login/session metadata remains useful for agent workflows, but is secondary and collapsed as Connected service identities.

### Settings

Purpose: everyday product preferences.

Connection/transport internals remain in an Advanced section inside Settings.

## Advanced navigation

### Coordination

Formerly "Requests".

AgentRequest is an internal structured coordination mechanism between Runtime/Desktop/Cloud/Worker and an AI agent. It is not a user prompt and not an approval.

The Advanced page shows:
- pending/claimed coordination first;
- durable event reconciliation when needed;
- completed/cancelled items only in collapsed history.

The page only gets a navigation badge when coordination is open or event replay needs attention.

### Activity

Operational logs and support diagnostics.

It is not a primary product workflow because Monitor already exposes human-readable current work.

### Sessions

Transport/session ownership troubleshooting.

### Runtime

Raw Runtime projection and compatibility/debug information.

### Secrets

Project credential storage. Values stay outside the renderer.

## Approval is contextual, not a permanent page

Approval is a first-class user action but not a permanent navigation destination.

When Runtime has a pending approval:
- Home shows Needs your approval;
- Monitor shows the same protected boundary;
- user can Approve or Deny the exact Runtime approval;
- high/critical approvals receive an additional confirmation prompt.

When there is no pending approval, no approval surface occupies the UI.

Approval decisions call Runtime public APIs directly:
- approvals.approve
- approvals.deny

They do not bypass Runtime policy, fingerprints or side-effect boundaries.

## Device history semantics

Cloud device inventory may include revoked registrations for audit.

Desktop must distinguish:
- Active devices: registrationState == active
- Device history: revoked/historical registrations

Historical rows must never inflate the "active/enrolled" fleet count.

## Remote work semantics

RemoteCommand is a transport/control-plane mechanism, not a Devices-page user workflow.

Remote execution should be:
- requested by ChatGPT / Worker / Cloud / user workflow;
- authorized by Cloud + Runtime;
- handed to the target Desktop/Runtime;
- visualized in Monitor.

Developer health checks and command-history probes do not belong in the normal Devices UI.

## Top-level product surface

The intended primary navigation is:

Home
Monitor
Devices
Skills
Account
Settings

Everything else is either contextual attention or Advanced.
