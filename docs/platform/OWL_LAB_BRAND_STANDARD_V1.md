# OWL LAB Brand Standard v1

Status: **Normative for user-visible product naming**

## Parent brand

The parent brand is:

```text
OWL LAB
```

Use uppercase `OWL LAB` in primary product chrome, onboarding, marketing, About screens and release metadata.

## Component/product names

```text
OWL LAB Desktop
OWL LAB Runtime
OWL LAB Cloud
OWL LAB Worker
```

Worker is the user-facing hosted product surface. It may be implemented inside the `owl-cloud` repository.

Cloud is primarily the service/control-plane name for identity, configuration, device and remote-control infrastructure.

## Recommended UI composition

Primary header:

```text
OWL LAB
Desktop
```

or:

```text
OWL LAB
Worker
```

Do not create four unrelated logos.

## Browser/window titles

```text
OWL LAB — Desktop
OWL LAB — Worker
OWL LAB — Account
```

A Cloud account/configuration page should normally present itself as OWL LAB Account, Devices or Settings rather than forcing users to understand the internal Cloud component.

## Runtime/technical surfaces

CLI, daemon status and support output may use:

```text
OWL LAB Runtime
OWL LAB Cloud
OWL LAB Desktop
```

Machine-readable metadata should use:

```text
product = owl-lab
component = desktop | runtime | cloud | worker
```

## Stable technical identifiers

Branding does not require immediate migration of technical identifiers.

Keep stable until a dedicated compatibility migration exists:

- repository names;
- package names;
- API namespaces;
- bundle identifiers;
- Keychain/service identifiers;
- Cloud resource names;
- persisted state directories.

For example, an existing bundle identifier may remain stable while the visible product name becomes `OWL LAB Desktop`.

## Deprecated user-visible names

Do not introduce new user-visible product copy using:

- AgentOS as the customer brand;
- OWL Platform as the parent brand;
- Computer MCP as the product name.

Historical compatibility identifiers and migration documentation may still mention them when technically necessary.
