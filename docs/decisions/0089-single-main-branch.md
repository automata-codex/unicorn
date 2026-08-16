---
id: ADR-0089
title: Single `main` branch
area: monorepo-tooling-deployment
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

No `main`/`develop` split. The value of a develop branch is protecting a stable branch from in-progress work when there are multiple contributors or a CI/CD pipeline deploying from `main`. Neither applies for solo development at this stage. Tagged releases provide the stable reference point. Revisit when there are collaborators or a deployment pipeline that warrants it.
