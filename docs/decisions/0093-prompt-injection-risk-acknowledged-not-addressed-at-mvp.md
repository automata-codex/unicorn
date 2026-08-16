---
id: ADR-0093
title: Prompt injection risk acknowledged, not addressed at MVP
area: security
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Prompt injection — the risk of a player crafting action text that manipulates Claude's behavior or extracts hidden state — is a known risk and is not addressed in Phase 1. At MVP scale (self-hosted, single player, no adversarial users), the risk is low and the engineering investment is not justified. The natural mitigation in SaaS deployment is that prompts are server-side and player input is clearly delimited in the message structure. Revisit before player input is injected into production prompts in a multi-tenant SaaS context. At that point, input sanitization and structural prompt hardening should be specced.
