---
id: ADR-0056
title: No utility framework — plain Svelte scoped styles
area: frontend-design-system
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Tailwind and similar utility frameworks were considered and rejected. The atomic class approach makes HTML harder to read and works against a strong per-system visual identity. More importantly, genre-specific theming (horror for Mothership, high fantasy for OSE, etc.) requires styles that are closely coupled to a semantic token layer — a utility framework adds friction without meaningful benefit in that model. Component styles live in Svelte's scoped `<style>` blocks. No utility framework is a dependency.
