---
id: ADR-0066
title: "`harnessVersion` is the git short SHA, not a hand-maintained constant"
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Recorded per rep and per row as `git rev-parse --short HEAD`, with a `-dirty` suffix when `apps/zoltar-be` has uncommitted changes, and `unknown` outside a git checkout. Same argument as `corpusVersion` being a content hash rather than a hand-bumped string: a manually maintained version fails silently when someone forgets to bump it, and the failure mode — two reps labeled identically under different checker semantics — poisons exactly the weeks-apart append the field exists to disambiguate.
