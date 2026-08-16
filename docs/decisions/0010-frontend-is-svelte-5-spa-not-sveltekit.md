---
id: ADR-0010
title: Frontend is Svelte 5 SPA, not SvelteKit
area: architecture-backend
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

SvelteKit's SSR and routing conventions add complexity without meaningful benefit for this product: the GM pipeline is entirely backend-driven, there is no SEO requirement, and the auth flow is owned by the backend. A plain Svelte 5 + Vite SPA is simpler to reason about, has no server-side rendering surface, and makes the frontend/backend boundary explicit. The tech stack entry in the design doc and README reflects this: "Svelte 5 (SPA)" not "SvelteKit."
