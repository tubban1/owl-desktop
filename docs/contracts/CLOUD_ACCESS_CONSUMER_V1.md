# Cloud Access Consumer Contract v1

Status: **Normative consumer contract for OWL Desktop 1.0**.

Canonical provider: `owl-cloud`.

Desktop consumes Cloud authorization decisions; it does not implement a second organization IAM engine.

## What Desktop may trust from Cloud

Cloud may tell Desktop:

- canonical `userId` / `organizationId`;
- device identity;
- effective device permissions for the signed-in user;
- a RemoteCommand already authorized for delivery to this device.

Desktop may use these for UI and transport decisions.

## What Desktop must still enforce locally

A Cloud-authorized command is **not permission to bypass Runtime**.

Desktop must still:

1. authenticate as the registered device;
2. deduplicate by `commandId`;
3. validate that the command targets this device;
4. map the request to a public Runtime contract;
5. let Runtime policy/approval decide whether the local side effect may execute;
6. return accept/reject/projection evidence without fabricating Runtime state.

## OWL 1.0 Cloud roles

Cloud roles are:

- owner
- admin
- operator
- member
- viewer

Desktop must not interpret these as Runtime capability levels.

In particular:

- owner/admin do not automatically gain local execution access;
- viewer never creates a RemoteCommand;
- run/schedule/approve are device-scoped effective permissions supplied by Cloud.

## Device credential handling

- Store device credential only in the OS credential store.
- Never log it or persist it in project/workspace state.
- Credential rotation replaces the stored credential atomically.
- Device revocation means Cloud transport is no longer authorized.
- Revocation does not imply Runtime process termination.

## Local-only mode

Local-only Desktop remains valid without Cloud login.

Cloud roles and DeviceGrants apply only to Cloud-connected features. Local Runtime permissions continue to be governed by local Runtime policy and OS permissions.

## No duplicated authorization

Desktop must not hard-code a second copy of the Cloud role matrix.

UI should consume effective access returned by Cloud, for example:

```text
canView
canRun
canSchedule
canApprove
```

The canonical authorization evaluator remains in `owl-cloud`.
