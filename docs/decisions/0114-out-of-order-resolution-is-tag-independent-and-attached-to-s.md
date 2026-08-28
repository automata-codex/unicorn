---
id: ADR-0114
title: '`out-of-order-resolution` is tag-independent, and attached to six more fixtures'
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  `ADR-0096` settled that the check *could* travel and deferred whether it *should*,
  pending a count. The count found 29 violations across five fixtures it was not pointed
  at, all of one shape. Records the count, the attachment, and why one fixture with zero
  observed failures is attached anyway.
---

## Context

`ADR-0096` made a check attachable to a fixture whose `tag` it is not, and named
`out-of-order-resolution` as the case that separates *portable* from *attached*: it reads
no `assertion`, only `applicability[checkId]` and the turn output, so it qualifies on the
merits — and it closed with "whether it should be attached to more fixtures is a corpus
decision, and is not made here." The `TAG_INDEPENDENT_CHECK_IDS` doc comment said the same
in its own words. Neither was an oversight; both were waiting on evidence.

The precedent for what that evidence looks like is `§ S34`, which counted
`SYSTEM-ROLLED-PLAYER-ACTION` occurrences in frozen artifacts *before* `ADR-0096` attached
the check to the `turn24-*` trio. This entry does the same for this check.

## The count

Every archived `warden-output.json` belonging to a fixture **not** carrying the check was
graded by `checkOutOfOrderResolution` with a synthesised `applicability` entry. Frozen
artifacts only: no Warden run, no Anthropic calls, no cost.

| Fixture | v | FAIL | pass | n/a |
|---|---|---|---|---|
| `turn19-system-rolled-player-action` | 2 | **13** | 149 | 2 |
| `turn21-system-rolled-player-action` | 2 | **8** | 136 | 6 |
| `turn21-narrating-past-a-block` | 1 | **5** | 140 | 5 |
| `turn24-over-resolution` | 2 | **2** | 25 | 110 |
| `turn24-hidden-info-leak` | 2 | **1** | 24 | 115 |

**29 violations, and every one is the same shape** — a consequence roll resolved while the
`dice_request` it depends on was still open:

> sequence 4: "Alvarez pulse rifle damage against contractor if combat check succeeds" was
> resolved for Alvarez while 1 dice_request(s) were still pending ("Combat check — shoot
> contractor at equipment bay door from heavy cover") — its gate had not resolved when this
> turn ended

None came through the other two branches (a roll preceding the turn's `player_action`, or
an in-turn `gatedByRollId` inversion). Nine other fixtures reached a verdict with no
failures at all.

## Decision

**`out-of-order-resolution` joins `TAG_INDEPENDENT_CHECK_IDS`, and six fixtures author an
`applicability` entry for it**, taking the check from 2 fixtures to 8.

`turn21-narrating-past-a-block` needed `fixtureSchemaVersion` 1 → 2 to be reachable at all:
the check declares `requiresFixtureSchema: 2`, so `runCheck`'s gate would have reported
`not_applicable` on every rep and the attachment would have bought nothing. The bump is
honest rather than cosmetic — v2 is "carries `applicability`", and it now does. Same move
`§ S35` made for the `turn24-*` trio.

### `turn24-scene-jump` is attached despite zero observed failures, and that is the point

It replays the same seq-116 turn as `turn24-over-resolution` and `turn24-hidden-info-leak`,
both of which fail this check. Attaching only the fixtures whose draws happened to fail
would infer applicability from what the model produced, which is exactly what `ADR-0073`
forbids and what `applicabilitySource: 'artifact'` exists to warn about. **Applicability is
a claim about the scenario, and the three fixtures are one scenario.** Selecting on the
outcome variable would also bias the resulting rate downward by construction.

### What is deliberately not attached

Nine fixtures reach a verdict on this check without ever failing it — `turn14-unauditable-
mapping` (39 passes), `5c34991b-turn09-unauditable-mapping` (18), the `5c34991b-turn10-*`
trio, and others. A strict reading of "applicability is a claim about the scenario" argues
for attaching those too: a scenario that produces a pass *is* a scenario the check applies
to.

Not done here, and the reason is that it is a different decision with a different cost.
Attaching six fixtures on the strength of observed violations widens coverage where the
behaviour demonstrably occurs. Attaching nine more on the strength of observed passes
widens the *denominator* into scenarios that have never once produced the failure, which
moves the tag's rate toward 1.00 without adding information — the shape `ADR-0082` names.
Worth deciding on its own evidence, not by extension from this one.

## Consequences

**Scoring-only bump.** Six `applicability` blocks and one `fixtureSchemaVersion` bump; no
`seededState`, `playerInput` or `assertion` touched. Every frozen `warden-output.json`
remains exactly as valid as it was, so the count above is reproducible as a real
measurement via `eval:rescore` rather than only as a prediction.

**The rate will move, and the movement is not about the Warden.** Going from 2 fixtures to
8 changes what the tag's number is a claim about. `§ S35`'s framing applies unchanged:
widening a check's corpus is not a way to make a rate fall, it is a way to make the rate
mean the corpus. Compare across this bump only on shared fixtures.

**Two of the eight run at `repOverride: 1`.** `ADR-0113` dialled the two
`-system-rolled-player-action` siblings down to one rep, and they carry 21 of the 29
counted violations. Their contribution going forward is therefore a tripwire, not a rate —
which is the right shape for them, since the turns they replay are already covered at full
N by their `-out-of-order-resolution` partners.

**The count is a lower bound.** The branch that produced all 29 routes through
`isAttributedTo`, a prose leading-name match on the roll's `purpose`. The checker's own
comment records that this "fails the way prose matching always fails here — silently, by
not matching," so any violation whose purpose text does not open with the player's name is
invisible both to this scan and to the check wherever it is attached. That is a property of
the checker, not of this attachment, and it is not addressed here.

**`capture-fixture` now stubs two tag-independent checks into every new fixture** rather
than one, fail-closed, so each capture is asked about this check as well.

## Alternatives considered

- **Leave it tag-bound.** Rejected by the count: 29 violations sat in artifacts no checker
  was looking at, which is `§ S34`'s finding reproduced for a second tag.
- **Attach without counting first**, on portability alone. Rejected in the ticket that
  preceded this entry and worth keeping: a check pointed at scenarios that cannot provoke
  it inflates the denominator with guaranteed passes, which is the same error as leaving it
  narrow, in the other direction.
- **Attach only where failures were observed** — five fixtures rather than six. Rejected on
  `ADR-0073`: that infers applicability from model output, and it biases the rate.
- **Attach everywhere the check reaches a verdict** — fifteen fixtures. Deferred above,
  with its own reasoning.
