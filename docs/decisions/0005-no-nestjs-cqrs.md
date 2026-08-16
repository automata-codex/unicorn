---
id: ADR-0005
title: No `@nestjs/cqrs`
area: architecture-backend
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

The API follows a CQRS-flavored pattern with clean separation between the command path (GM pipeline) and the query path (direct DB reads), enforced by NestJS module boundaries. The formal `@nestjs/cqrs` command/query bus infrastructure adds overhead without meaningful benefit at this scale. Module separation achieves the same discipline.
