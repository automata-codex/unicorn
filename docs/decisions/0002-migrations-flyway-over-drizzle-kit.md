---
id: ADR-0002
title: "Migrations: Flyway over drizzle-kit"
area: architecture-backend
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Flyway is ORM-agnostic and produces plain SQL migration files that are inspectable, version-controlled, and portable. Drizzle-kit generates SQL from schema diffs, which is useful during development but ties migration management to the ORM. Running Flyway from a Docker container in the Compose stack eliminates the JVM overhead concern. The two tools are not in conflict — drizzle-kit can be used for schema diffing during development while Flyway owns what actually gets applied.
