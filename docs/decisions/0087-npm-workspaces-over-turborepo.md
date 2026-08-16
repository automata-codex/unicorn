---
id: ADR-0087
title: npm workspaces over Turborepo
area: monorepo-tooling-deployment
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Turborepo deferred until there is a concrete need — parallel builds across many packages, remote caching, a CI pipeline that would benefit from task graph optimization. For a small monorepo in early development, npm workspaces is sufficient and has no additional tooling overhead. Migration to Turborepo is straightforward when the time comes.
