---
id: ADR-0059
title: Bits UI for headless accessibility primitives
area: frontend-design-system
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

No opinionated component library is used. Bits UI (the Svelte 5 headless primitive library, successor to Melt UI) is used for accessibility-critical interactive patterns — modals, dropdowns, tooltips, focus traps — where rolling bespoke implementations would be high-risk. All visual styling of Bits UI primitives is owned by the application. This gives accessibility correctness without importing a competing design language.
