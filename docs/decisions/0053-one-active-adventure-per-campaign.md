---
id: ADR-0053
title: One active adventure per campaign
area: api-data-model
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Campaigns are limited to one adventure in a non-completed, non-failed state at a time. A new adventure cannot be created while another is `synthesizing`, `ready`, or `in progress`. This matches solo play conventions and simplifies the state model. Completed and failed adventures remain visible (toggled by default) but do not block new adventure creation.

**Addendum — one adventure per campaign, full stop, through `v0.1.0`**

The entry above permits a second adventure once the first is completed or failed:
"Completed and failed adventures remain visible (toggled by default) but do not block new
adventure creation." **That permission is withdrawn for `v0.1.0`.** A campaign may have
exactly one adventure, in any status.

**Why the original allowance does not survive contact with the rest of the roadmap.**
Creating a second adventure is permitted, and nothing behind it works:

- `campaign_canon` does not exist and synthesis does not read it — the roadmap places
  both in Phase 2 ("Campaign canon — second promotion step at adventure completion;
  `campaign_canon` table; synthesis reads campaign canon alongside oracle results for
  subsequent adventures"). Adventure 2 would be synthesized with no knowledge of
  adventure 1.
- `adventure.rolling_summary` stays null through Phase 1 by
  `§ Phase 1 continuity is carried by cached GM context and working-memory fields, not a
  rolling summary`, which defers it to Phase 2 for the same reason — "where the related
  'what persists across adventures' questions already need answering."
- Adventure-scoped state is not separated from campaign state, so adventure 2 inherits
  adventure 1's synthesized entities, pools, and flags. Overlapping entity ids across
  adventures collide silently in the flat pool map, and `buildResourcePools` preserves on
  conflict — the same failure shape as the `lt_alvarez` / `alvarez` incident.

So two recorded decisions point in opposite directions, and the combination actually
shipping — door open, nothing behind it — was chosen by neither. This addendum closes the
door rather than building the floor.

**The constraint is a data guarantee, not just a product limitation, and that is the
point.** With exactly one adventure per campaign in every self-hosted database at
`v0.1.0`, provenance is unambiguous *by construction*: every entity, pool, and flag in a
campaign belongs to its sole adventure. The Phase 2 migration into the separate adventure
state row is then mechanical. Without the constraint it would have to *infer* which
adventure each key came from, which for overlapping ids across two finished adventures is
not recoverable at all.

**Why not the cheaper intermediate.** Tagging entities and pools with an adventure id now
was considered and rejected: it ships self-hosters a format that is neither the current
shape nor the terminal one, and it obliges either a second migration or permanent support
for an interim shape. The single-adventure constraint achieves the same guarantee — no
ambiguity in shipped data — without shipping a transitional format at all. The
door-closing code is throwaway, and small.

**Scope of the closure.** It must block creation after `completed` and `failed`, not only
during an active adventure. The original entry explicitly allows the former, which is
what lets a campaign accumulate two adventures' worth of state today.

**What this costs.** Mothership's attrition model does not need `campaign_canon` —
character carry-forward alone ("Strength still 27, Maximum Wounds down to 2") is most of
what M7.6 is building toward, and this defers it. Accepted as a beta-stage limitation.
The counterweight is that character carry-forward across an adventure boundary is
currently broken in the ways listed above, so what is deferred is a feature that does not
work rather than one that does.

**Reversal condition.** Lift the constraint when the adventure state row exists,
`campaign_canon` feeds synthesis, and a dedicated boundary playtest has run — the last of
which must not be combined with a mechanical-coverage playtest, per the standing rule in
`docs/roadmap.md`.
