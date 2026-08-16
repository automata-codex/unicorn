---
id: ADR-0001
title: "ORM: Drizzle over TypeORM"
area: architecture-backend
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Drizzle's approach to Row Level Security is cleaner than TypeORM's — setting Postgres session variables and working with RLS policies requires less ceremony. Drizzle also produces more predictable SQL and infers TypeScript types directly from the schema definition at compile time, with no generation step. TypeORM is the NestJS default but not the right fit here.
