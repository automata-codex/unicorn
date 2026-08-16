---
id: ADR-0064
title: One check per fixture today, but the row format is N-ready
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

`selectChecksForFixture` returns an array, and every downstream reader — score rows, rate computation, comparison — is built against "a fixture may have N checks." Today it always returns exactly one, because a judged check needs per-fixture `assertion.facts` (`perceptionBoundary`, `expectedScope`, …) that only exist for the fixture's own tag: running `HIDDEN-INFO-LEAK` against a `SCENE-JUMP` fixture has no boundary text to grade against, and would cost an API call per fixture-check pair to produce one that doesn't exist. The corpus is what's 1:1 today, not the format — giving a fixture a second check later is a registry change, not a schema migration.
