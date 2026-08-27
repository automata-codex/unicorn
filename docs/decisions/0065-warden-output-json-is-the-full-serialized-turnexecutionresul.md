---
id: ADR-0065
title: "`warden-output.json` is the full serialized `TurnExecutionResult`, not just `submit_gm_response`"
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Why the artifact is the whole serialized `TurnExecutionResult` and not the
  `submit_gm_response` payload the spec describes: `eval:judge-variance` re-runs
  checks against a frozen artifact with no database at all, so anything narrower would
  force re-seeding a scratch campaign per re-evaluation or keeping every one alive.
---

The spec describes the artifact as "full `submit_gm_response` payload." That's not enough on its own: `eval:judge-variance` re-runs judged checks against a frozen artifact with **no database at all** — the scratch campaign is torn down at the end of every fixture run by default — so the artifact has to carry everything a structural checker or the judge needs to re-evaluate the turn. The judge summarizes the whole tool-call sequence, not just the narration, so it needs `gameEvents`; structural checkers additionally need `telemetry`/`pendingCanon`/`diceRequests`/`campaignState`. `warden-output.json` is a strict superset of `submit_gm_response`'s payload — the serialized `TurnExecutionResult`, with the narration living inside its `gm_response` game event. Anything narrower makes `eval:judge-variance` impossible without either re-seeding a scratch campaign per re-evaluation or keeping every scratch campaign alive forever, which would defeat the reason `--keep-scratch` defaults to off.
