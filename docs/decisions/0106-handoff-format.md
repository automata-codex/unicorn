---
id: ADR-0106
title: 'Cross-Context Handoff Format'
area: monorepo-tooling-deployment
status: provisional
superseded_by: null
milestone: M7.7
summary: >-
  The `handoff` block format for moving work between Claude Code and Claude Web:
  header fields, the closed `ask` set, and the body shapes for `review-decision` and
  `verify-claims`. Provisional — the open questions at the end are the experiment's
  own success criteria.
---

## Purpose

Zoltar development runs across two Claude contexts: **Claude Code** (CC), which
has repo and database access and — as of this experiment — authors decisions,
ADRs, eval methodology, and implementation; and **Claude Web** (CW), which
reviews CC's work. Work moves between them by copy/paste of individual turns.

This format exists so that a pasted turn is unambiguously a handoff, states what
response is wanted, and bounds what the receiver should do. Its main job is
keeping review substantive: CC authors from inside the code, so the risk is not
factual error but unexamined framing — alternatives never considered, principles
that cost effort now to save it later, reasoning that evaporates with the session.

## Envelope

Every handoff opens with a fenced `handoff` block containing the header, followed
by unfenced body sections.

    ```handoff
    from: CC | to: CW
    re: ADR-0107 draft
    ask: review-decision
    scope: reasoning only — implementation plan is settled
    limit: 300 words
    ```

### Header fields

| Field | Required | Meaning |
|---|---|---|
| `from` / `to` | yes | `CW` or `CC`. |
| `re` | yes | Subject. Prefer a stable identifier (`ADR-NNNN`, spec number, milestone). |
| `ask` | yes | What response is wanted. Closed set, below. |
| `scope` | no | Explicit bound on what the receiver should do. |
| `limit` | no | Word cap on the response. |

### `ask` values

- `review-decision` — argue with the reasoning. The primary path.
- `verify-claims` — check the stated claims against the code; report verdicts only.
- `sanity-check` — open-ended; flag anything that looks wrong.
- `fyi` — no response needed.

Anything not on this list means the sender hasn't decided what they want.

---

## Primary path: `review-decision` (CC → CW)

### Outbound body

    DECISION
    <what was decided, in one or two sentences>

    REASONING
    <why — the argument, not a restatement of the decision>

    ALTERNATIVES
    A1. <option considered> — rejected because <reason>
    A2. <option considered> — rejected because <reason>

    PRESSURE
    <what CW should push hardest on, or "open">

`ALTERNATIVES` is the section most likely to be skipped and the one most worth
keeping. An implementer writing from inside the code records what was chosen and
drops what was dismissed, because the dismissal happened in a session that then
evaporates. `decisions.md` is supposed to hold both.

`PRESSURE` names the part the author is least sure of. Without it, review
gravitates to whatever is easiest to comment on.

### Return body

    BLOCKING — <the decision does not hold as written; say why>
    CONCERN  — <the decision holds but something is unaddressed>
    NOTE     — <minor, take it or leave it>
    UNCHECKED — <a premise CW cannot verify without the code; CC should confirm>

    VERDICT: proceed / revise / blocked

Severity first, one entry per line, no preamble. `UNCHECKED` is the reviewer's
counterpart to a wrong claim: CW cannot see the repo, so any point resting on
what the code actually does is flagged and handed back rather than asserted.

An empty return is a legitimate outcome. `VERDICT: proceed` with no entries above
it means the reasoning holds.

---

## Secondary path: `verify-claims` (CW → CC)

For the cases where CW does draft something — an ADR, a methodology note — that
rests on assertions about the current codebase.

### Outbound body

    CLAIMS
    C1. `session.validator.ts` seeds entity writes from a hand-enumerated field list.
    C2. The advisory lock spans `applyTurnAtomic` only, not the full turn cycle.

    BODY
    <the ADR, decision, or question>

Each claim is one checkable assertion about the code, stated separately from the
reasoning that depends on it. Separating them makes verification mechanical and
makes the document honest about what it assumes.

More than three or four claims means the artifact should have been drafted in CC,
where the code is. This format is for checking work, not transmitting specs.

### Return body

    C1 CONFIRMED — `entity.merge.ts:88`, list at L40–52.
    C2 WRONG — lock acquired in `turn.service.ts:210`, released after event
       emit. Spans the full cycle.
    C3 (unstated) — `judgeContext` renderer is invoked before the lock.

    VERDICT: revise C2, then proceed.

One line per claim. Verdict first (`CONFIRMED` / `WRONG` / `PARTIAL` / `UNVERIFIABLE`),
then `file:line` evidence. `PARTIAL` and `UNVERIFIABLE` carry a one-line reason.

`(unstated)` entries are for premises the sender got wrong that do not block the
plan. Without a slot for them they go unmentioned, and false premises accumulate
in the record reading as settled fact.

---

## Rules

1. **Correct at the source.** A `BLOCKING` or `WRONG` verdict means the originating
   document is edited. Working around it downstream leaves the record wrong.
2. **Do not exceed `scope`.** If the scope looks mistaken, say so in the return
   rather than acting outside it.
3. **`fyi` means no reply.** Returning a review to an `fyi` handoff is noise.
4. **Review is not comprehensive.** CW sees what it is shown. A decision whose
   reasoning is not written down cannot be reviewed, and framing that both
   contexts share will not be caught by either.

## Open questions

- Whether `review-decision` returns stay useful without code access, or degrade
  into restating the argument back. This is the load-bearing question for the
  experiment; `UNCHECKED` is the early-warning signal — if most entries are
  `UNCHECKED`, review is running on guesses.
- Whether `ALTERNATIVES` survives contact with implementer-authored ADRs, or has
  to be reconstructed after the fact.
- Whether the block should be recorded in `decisions.md` when a verdict changes an
  ADR, or whether the corrected ADR is sufficient record.
