# Desktop 1.x Integration V2 Evidence

Candidate Desktop branch: local/desktop-integration-v2
Runtime orchestration source under test: 72e95c5c2cf475e6100dc67dccbfaceba60ae7d4

Integrated product changes:

- Multi-device Cloud control plane and Devices UI;
- Live Orchestration Monitor V2;
- explicit Runtime orchestration worksets;
- canonical Task Timeline / Graph / Inspector;
- orchestration product-live cross-repository gate;
- stream-loss recovery through read-only orchestration_snapshot MCP tool.

Latest combined gate:

- targeted integration: 6 files / 15 tests PASS;
- Desktop full suite: 28 files / 131 tests PASS;
- TypeScript and Vite production build PASS;
- cross-repository orchestration product-live PASS;
- public workset grouping PASS;
- unrelated Task exclusion PASS;
- canonical Task DAG PASS;
- selected Task inspector PASS;
- git diff-check PASS.

Cutover dependency:

Runtime main must fast-forward from 54e3a90 to 72e95c5 before live Goal worksets can be produced. Legacy Tasks without orchestration metadata remain valid and project orchestration = null.

Desktop main can then fast-forward from 12ab302 to this integration branch after final dev:full restart.
