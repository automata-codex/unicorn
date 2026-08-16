---
id: ADR-0058
title: Theme switching via `data-theme` attribute
area: frontend-design-system
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

The active theme is applied by setting a `data-theme` attribute on the root element. Each theme is a CSS file defining the semantic token layer (e.g. `themes/mothership.css`, `themes/fantasy.css`). The primitive token definitions live in `themes/base.css` and are always loaded. This approach requires no JavaScript theming library and works naturally with Svelte's reactivity.
