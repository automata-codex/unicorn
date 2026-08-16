---
id: ADR-0069
title: "`eval:harness` retired, not kept alongside `eval:run`"
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

The multi-run harness's whole premise is separating execution from rendering — `eval:run` writes score rows, `eval:report` reads them, and nothing downstream parses markdown. Leaving `eval:harness` in place would have kept a second write path producing no score rows, which is the thing this milestone existed to eliminate. `eval:replay` survives — repointed at the unified check registry — and gained an artifact-based mode (`--run-dir --rep`, no database), covering the quick single-fixture-iteration use `eval:harness` was also serving.
