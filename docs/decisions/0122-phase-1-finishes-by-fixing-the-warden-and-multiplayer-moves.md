---
id: ADR-0122
title: Phase 1 finishes by fixing the Warden's known errors, and multiplayer moves to Phase 2
area: architecture-backend
status: accepted
superseded_by: null
milestone: M8
summary: >-
  Decided 2026-10-16. The three playtests surfaced 25 Warden error tags. Ten are
  fixed, and thirteen are open and fall into five causes (`eval-findings.md §
  S80`). Phase 1's target is a playable solo adventure, and those errors stand
  between the product and that target. Multiplayer does not. So the caller model
  and initiative (old M8) move to Phase 2, and old M8.1 is dropped. Phase 1
  instead runs M7.9, then M7.10 for positions, then one milestone per remaining
  cause: M8 Damage Resolution, M9 Untracked NPCs, M10 Emit What You Narrate, and
  M11 Roll Adjudication. Release becomes M12.
---

## The problem

**Phase 1's target is "a playable solo Mothership adventure on a personal
Droplet."** Multiplayer was scheduled in Phase 1 as M8, but it does nothing for
one player.

**The Warden's errors stand in the way of that target.** `eval-findings.md §
S80` catalogs every error the three playtests annotated. Thirteen are open:
wrong places and distances, lost wound carryover, NPCs the backend cannot track,
changes narrated and never written, and roll outcomes the Warden decides that
code could. Each one affects a solo adventure.

**Multiplayer would make them harder to see.** M8's playtest was meant to test
the caller model and initiative. Run against a Warden with thirteen open errors,
it would have shown both kinds of failure at once.

The maintainer, 2026-10-16, after "thinking about this project, its direction,
and the bigger picture": the course correction is to move multiplayer out and
give each Warden error a home.

## What was decided

**Multiplayer moves to Phase 2.** That covers the caller model, voluntary and
requested transfer, offline claim, `caller_transfer`, initiative mode,
`advance_initiative`, the frontend for each, the turn-path lock audit, and the
multi-PC playtest. Phase 2 already has synchronous multiplayer through Ably, so
it is the natural place for asynchronous multiplayer too.

**Phase 1 runs in this order:**

| Milestone | Delivers | Measured by |
|---|---|---|
| M7.9 | The v2 harness, finished as scoped | — |
| M7.10 | Places and routes (`ADR-0121`) | Question 1 |
| M8 | Damage Resolution: code applies a hit (`ADR-0123`) | Question 2 |
| M9 | Untracked NPCs: an NPC can become an entity, and the merge keeps its fields | A new question |
| M10 | Emit What You Narrate: changes, canon and retcons are written, not just narrated | A new question |
| M11 | Roll Adjudication: code judges player rolls against their target (`ADR-0123`) | A new question |
| M12 | Self-hosted deployment and `v0.1.0`, formerly M9 | A closing steered playtest |

Each of M8–M11 is a milestone, not a card, because each needs its own eval
question to show the fix worked. M7.10 set that pattern with question 1.

**Old M8.1 is dropped.** Its one item, a contingency field for
`OVER-RESOLUTION` and `OUT-OF-ORDER-RESOLUTION`, targets two tags that now pass
(`§ S80`). It was also the prompt-iteration milestone, and M10 takes over that
role.

**The milestones are renumbered.** As of this entry, M8 means Damage
Resolution. In entries written before 2026-10-16, "M8" means the multiplayer
milestone, "M8.1" means Warden Prompt Iteration, and "M9" means self-hosted
deployment, now M12. Those entries are not rewritten.

**One part of the lock audit stays in Phase 1.** `ADR-0119` notes that a single
player can send a second turn while the first is still running. That case does
not depend on multiplayer, so a server-side guard against it is part of M12.

**M12 gains a closing steered playtest.** `ADR-0121` relied on M8's playtest to
show that positions stay right over a whole session. That job now falls to a
playtest run before the release, across everything M7.10–M11 changed.

## Alternatives

**Keep M8 in Phase 1, after the fixes.** This would still ship multiplayer
before `v0.1.0`. It was declined because the release does not need multiplayer
and the work is large: a lock audit, a caller model, initiative, and a playtest
that needs several players.

**One milestone for all the fixes, with a card per cause.** This means less
roadmap. It was declined because each cause has its own fix, its own question,
and a different review tier. One milestone would be closed by the slowest of
them.

**Keep the M7.x numbering.** This would avoid an ambiguous "M8" in older
entries. It was declined at the maintainer's request: the M7.x series had grown
to ten milestones of tooling, and the renumbering marks the change from
building the harness to fixing the Warden.

## What would reverse it

- A real need to play Phase 1 with more than one player before `v0.1.0`.
- The fix milestones turning out not to move their questions. That would
  bring back the case for broader prompt iteration that M8.1 was meant to
  provide.
