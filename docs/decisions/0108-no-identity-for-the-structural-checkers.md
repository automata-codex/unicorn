---
id: ADR-0108
title: Structural checkers get no identity hash — the repair hatch is what makes them different
area: eval-harness
status: accepted
milestone: M7.7
superseded_by: null
summary: null
---

**Decided 2026-08-22, and recorded so the omission reads as a decision rather than an
oversight.**

**The gap is real.** `corpusVersion` hashes fixture *files*, so it answers "did the inputs
change" and says nothing about the code that grades them. Adding `TOOL-SYNTAX-LEAK` left
`corpusVersion` at `1c2a418cf68c` while the runs began measuring something they had not
measured before. [[0099-the-code-built-prompt-surfaces-get-their-own-identity-separa]] named
this and declined it — *"extending this mechanism to the checker registry is a reasonable
next step and is not taken here"* — and spec 020 covers only the judged half, via
`judgeContractHash` ([[0102-the-judge-contract-gets-its-own-identity-and-the-verdict-fol]]).
The structural half (`system-rolled-player-action`, `out-of-order-resolution`,
`tool-syntax-leak`) still carries no identity. `harnessVersion` cannot serve as one, for the
reason it never could: it is the git short SHA and would fire on every comparison
([[0066-harnessversion-is-the-git-short-sha-not-a-hand-maintained-co]]).

**Decision: no hash. The reason is repair cost, not severity.** Structural checkers are
deterministic and `eval:rescore` regrades them for free — no Warden calls, no judge calls.
A run mislabelled by a checker edit is therefore repairable after the fact at zero spend,
by rescoring both sides under today's registry and comparing those.

**The judged half has no such hatch.** That is precisely why the two known data corrections
in `docs/eval-methodology.md` are still prose corrections rather than repaired numbers. The
two halves look symmetrical and are not, and that asymmetry is the whole justification.

**Revisit if** a structural checker edit ever lands that `eval:rescore` cannot undo. A
checker that reads something no longer present in the archived artifact would be that case.
