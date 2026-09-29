# OWL LAB Desktop Account & Runtime Access v1

Status: **Target product contract for Integration Gate I3**

## Product rule

A normal OWL LAB Desktop user must sign in to an OWL LAB Cloud account and enroll the device before normal Runtime mutations are enabled.

Runtime itself does not receive the user's Cognito password or own Cloud authentication.

## Startup states

```text
Desktop launches
  -> Runtime Host may start in LOCKED mode
  -> version / health / diagnostics remain available
  -> no ordinary consequential execution is accepted

Cognito PKCE login
  -> account bootstrap
  -> device registration
  -> DeviceGrant
  -> account refresh credential + device credential stored in OS-backed vault
  -> scoped local execution grant
  -> Runtime READY
```

Expected access state:

```text
LOCKED
READY
REVOKED
```

## Cloud authority

Cloud owns:

- human account identity;
- organization membership;
- device identity;
- DeviceGrant and revocation;
- bounded offline authorization policy.

Desktop is the local identity broker.

Runtime is the execution authority after authorization has been established.

## Offline behavior

Cloud availability must not become a synchronous dependency for every local action.

After successful login/enrollment, Desktop may hold a bounded offline execution lease.

```text
temporary network loss
-> existing authorized local work may continue within lease/policy
-> Desktop records degraded Cloud state
-> reconnect performs reconciliation
```

If the device is revoked or the offline lease expires:

```text
new mutations -> rejected
new schedule occurrences -> paused / needs_attention
in-flight consequential work -> settles at a safe Runtime boundary
```

Do not silently convert Cloud loss into successful execution.

## Logout

Logout revokes local authorization for new work. It does not blindly kill a process in the middle of an unknown side effect.

Desktop requests a safe Runtime transition:

- reject new mutations;
- settle the current consequential boundary;
- pause durable work at a recoverable point;
- preserve audit/provenance.

## Secret handling

The renderer never receives:

- Cognito access/refresh tokens;
- PKCE verifier;
- device credential;
- local execution grant secret.

Use OS-backed secure storage.

## Relationship to Desktop Cloud enrollment

The existing real PKCE/device-enrollment work is the implementation foundation for this contract.

The product gate is not complete until a real Mac proves:

```text
login
-> bootstrap
-> enrollment
-> vault
-> Runtime unlock
-> real execution
-> disconnect
-> reconnect
-> grant reconciliation
```
