---
id: ADR-0119
title: OPEN — concurrent turns on one campaign can lose updates, and the turn path's locking is incidental rather than designed
area: architecture-backend
status: open
superseded_by: null
milestone: M8
summary: >-
  OPEN. A turn reads its state outside the transaction, then writes back whole
  `campaign_state.data` and `gm_context.blob` values computed from that read. So two
  concurrent turns on one campaign wait on a row lock, commit one after the other, and
  the second silently overwrites the first. The locks that exist were never designed to
  serialize turns. It is harmless with one player per adventure; the M8 turn-path lock
  audit has to settle it.
---

*Opened 2026-09-30 from `docs/human/turn-path.md`. Confirmed by reading the code, not by a test. Not yet decided.*

## What a turn does

`SessionService.sendMessage` reads first and writes later, and only the writes are in a transaction.

**The reads happen outside any transaction.** Five precondition reads run in parallel: the GM context blob, `campaign_state.data`, the player entity ids, the message history, and the player dice rolls since the last GM response. Everything downstream is computed from these values: the prompt, validation, and the new state (via `applyValidatedTurn`). The Claude calls in the tool loop sit between the reads and the writes, so the gap is seconds to tens of seconds long.

**The writes happen in one transaction.** `SessionRepository.applyTurnAtomic` persists values the caller has already computed. It does not compute deltas. Two of those writes replace a whole JSONB value:

- `campaign_state.data`, the first statement in the transaction
- `gm_context.blob`

## The lost update

Take two turns, A and B, on the same campaign:

1. A and B both read the same `campaign_state.data`. Call it S0.
2. Each calls Claude and computes its own new state: A computes S0 + ΔA, and B computes S0 + ΔB.
3. A commits. B's `UPDATE campaign_state` waits on A's row lock, then commits S0 + ΔB.

The stored state ends up as S0 + ΔB. A's changes, such as pool damage, flags and entity updates, are gone, and no error is raised. `gm_context.blob` loses A's NPC agenda changes in the same way.

The event log does not lose anything, because `game_event` rows are inserts. Both turns' `state_update` events survive. So the log and the stored state now disagree, and replaying with `reconstructStateAsOfTurn` would fold in both ΔA and ΔB, giving a state the live game never had. B's prompt was also built without A's turn in the message history, so B's narration can contradict A's.

The row lock makes the writes happen one after the other, so they don't collide. It does not prevent the lost update, because the value being written was computed before the lock was taken.

## The locks that exist, and why they are incidental

- **The campaign lock.** The `UPDATE` on `campaign_state` takes an exclusive row lock keyed by campaign.
- **The adventure lock.** `nextSequenceNumber` takes a `SELECT … FOR UPDATE` lock on `adventure`, keyed by adventure. It exists so each turn's `game_event` sequence numbers come out contiguous. Serializing turns was not its purpose.

Both locks are held until commit. The campaign lock is taken first, so two adventures in the same campaign serialize against each other even though they never contend for the same `adventure` row. The coarser lock is the one that decides.

Nothing enforces the order the two locks are taken in. A future writer that touches `campaign_state` after sequence allocation could deadlock against a turn. Until this entry is settled, treat "`campaign_state` before `adventure`" as a convention.

## Why it doesn't bite yet

- There is one player per adventure. `ADR-0053` also allows only one active adventure per campaign, so in normal play only one turn is in flight per campaign.
- **One case doesn't need M8.** The same player can send a second turn while the first is still running. `Play.svelte` blocks this within one page with its `sending` flag, but the server does not enforce it. Two tabs, or a client that retries after a timeout, could still produce concurrent turns.

## Questions for the M8 audit

1. **Is `campaign_state.data` really campaign-scoped?** If it is, the coarse campaign lock is load-bearing. If it is effectively per-adventure, the campaign lock serializes more than it needs to. `ADR-0053` makes this moot for now. Does M8 change that?
2. **Which mechanism should prevent the lost update?** The candidates:
   - **An application-level guard.** Refuse a turn while another is in flight for the same adventure or campaign. The M8 caller model may already provide this for narrative turns, but it has to cover the dice-result auto-advance path too.
   - **Pessimistic locking.** Take the lock before the reads, with `SELECT … FOR UPDATE` on `campaign_state`, and do the reads inside the transaction. The cost is that the transaction then spans the Claude calls, holding a row lock for tens of seconds.
   - **Optimistic concurrency.** Add a version column to `campaign_state` and `gm_context`, and make `applyTurnAtomic` write only if the version is unchanged since the read. On a mismatch, reject the turn and let the client retry. The cost is that the Claude spend for the rejected turn is wasted.
3. **Should the lock-order convention be enforced, or does the answer to question 2 make it unnecessary?**

Nothing here is decided. This entry records the analysis so the audit starts from it, not from scratch.
