---
id: ADR-0095
title: Plans and specs are committed to the repo
area: monorepo-tooling-deployment
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

`docs/plans/` and `docs/specs/zoltar/` are tracked in the repository and stay tracked.

**This records current practice, not a fresh decision.** An earlier practice kept plans and specs out of the repo. That reversed at some point without either the original policy or the reversal being written down, and the reasoning behind either is not recoverable — so this entry states what is true rather than reconstructing why it became true.

**What made the gap visible.** A bullet in M9's documentation-reorganization item proposed pruning accumulated `docs/specs/zoltar/` entries on the grounds that they are "ephemeral by policy," citing a policy that exists nowhere in `docs/`. The citation had been dangling since it was written, because the policy it named had been reversed and the reversal never recorded. The clause was removed rather than repointed on 2026-08-16, since with specs committed and kept there is no standing policy that makes them sweepable.

**Why they stay, as observable from how they are used rather than as remembered rationale.** Decisions entries and specs cite plan files by path, so removing them would break references that the validator now enforces. A CC session loads them as working context; they are a substantial part of what makes a fresh thread productive. And a plan's git history is the record of how a milestone was actually sequenced, which the milestone's own commits do not capture.

**What this does not settle.** Whether plans and specs are *public* artifacts is a separate question and stays open in the M9 bullet, which notes that `decisions.md` is arguably the most valuable thing to publish and `docs/plans/` the least. Tracked in the repo and published to a `v0.1.0` audience are different commitments; this entry makes only the first.
