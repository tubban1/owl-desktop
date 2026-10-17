# OWL LAB — Connectivity Incident Diagnostics v1

This is a developer contract for OWL Desktop. DEV feature status does not imply packaged production availability.

## Evidence layers

1. Device link: non-loopback IPv4 or IPv6 network interfaces. No interface suggests a local network problem, but a present interface does not prove internet access.
2. DNS: timeout-bounded lookup of \`www.cloudflare.com\`, recorded only as success/failure.
3. Independent internet: timeout-bounded GET to \`https://www.cloudflare.com/cdn-cgi/trace\`; discard the response body. A failed probe does not prove the customer's ISP or router failed.
4. Local Tunnel: existing Connection Host / TunnelSupervisor localhost readiness.
5. Remote control plane: native Tunnel reachability and status evidence.
6. Provider context: published incidents from \`https://status.openai.com/api/v2/incidents.json\`, matched against the local incident period. **Time overlap never establishes that OpenAI caused a specific Tunnel failure.**

## Triggering, privacy and resilience

- The local Tunnel state and a zero-traffic OS interface check are sampled every 5 seconds. Link loss can supersede a still-cached healthy Tunnel result. Three consecutive unhealthy samples open an incident; two verified-ready samples close it.
- Independent DNS, Cloudflare and OpenAI checks run **only when Settings → Diagnostics is enabled**, while an incident is active, at most once every 60 seconds.
- External providers will observe the HTTP request's public source IP. OWL sends no tokens, file paths, Wi-Fi name, local IP/MAC list, project contents or chat messages.
- An incident never automatically cancels accepted durable Runtime tasks, and a failed external probe never alone forces a Tunnel restart. Existing supervisor owns Tunnel recovery policy.
- Events are kept in \`connectivity-incidents.json\` under Electron user data, file mode 0600, maximum 200 sanitized entries. Types: degraded, evidence, recovered. Retained evidence is allowlisted categories/timestamps/duration only.

## Honest interpretations and remaining QA

- Old Tunnel warnings collected before this implementation have no local DNS/link evidence. They cannot be retroactively attributed to a local outage or an OpenAI incident.
- One independent HTTPS endpoint may be blocked even if the internet is usable. Report an unverified independent path, not a definitive ISP failure.
- Real user-visible macOS background Notification delivery is still awaiting isolated native fault injection; the current tests exercise the incident state machine and simulated network probes, not disruption of the user's Wi-Fi.
- Windows/Linux provider and notification acceptance, captive portal/VPN transitions, packaged production rollout, and Durable Cloud MCP monitoring remain separate acceptance milestones.
