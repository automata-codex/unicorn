---
id: ADR-0060
title: Mobile-first design — layouts originate at mobile size
area: frontend-design-system
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

All UI layouts are designed at mobile size first and expanded for larger viewports. This applies from the pre-M3 design sprint forward and is a constraint on all subsequent frontend work. The M9 "layout pass" is a responsive polish pass, not the origin of mobile layout decisions. The play view in particular — message log, input field, character status, dice UI — is a constrained layout problem better solved small-to-large than large-to-small.
