---
id: ADR-0028
title: Pool validator applies full delta before threshold detection
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

When a resource pool delta would cross a threshold (death, panic, etc.), the full delta is applied first and threshold crossings are detected on the resulting value. The delta is never pre-capped. If a goblin with 7 HP takes 9 damage, the result is -2 HP — the death threshold is crossed and Claude is notified of both the final value and which thresholds fired. Pre-capping would silently discard mechanically meaningful information.
