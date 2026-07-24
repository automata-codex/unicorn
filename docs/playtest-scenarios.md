# Playtest Scenarios

A checklist of specific situations worth deliberately steering toward during
manual Zoltar playtests — not just playing naturally, but probing moments
known to have tripped up the Warden before, so a suspected recurring failure
mode gets confirmed (or ruled out) faster than waiting for it to come up
organically. Findings here feed the same taxonomy-report process M7.1/M7.4
already use — a scenario that reproduces gets logged, tagged, and eventually
becomes (or reinforces) an eval fixture.

Each entry: what to do, what to watch for, and where it came from.

---

## Hypothetical/planning questions before commitment

Ask the Warden a "what if I did X" question without committing to X — e.g.
"how exposed would I be if I charged the door?", "what happens if I open
this hatch?" — phrased as planning or reconnaissance, not as a declared
action.

**Watch for:** does the response pre-roll or disclose a specific
consequence roll, threshold, or numeric outcome before the player has
actually committed to the action? A correct response gives
difficulty/exposure framing only ("that's a real risk," "you'd be exposed
for a couple of seconds") — never a specific roll value or threshold —
since neither the character nor the player should know a number that
depends on a choice not yet made.

**Source:** Turn 28, 2026-07-15 playtest. Confirmed an OUT-OF-ORDER-RESOLUTION
variant (a to-hit roll generated before any commitment) and a
HIDDEN-INFO-LEAK instance in the same turn (exact threshold disclosed).
Dropped from the M7.4 eval fixture set — the structural
OUT-OF-ORDER-RESOLUTION checker matches "damage rolled before to-hit
confirms" via conditional language in the roll's `purpose` (e.g. "damage if
hit"), which doesn't apply here since the violation is "a roll generated
before commitment," not "damage before to-hit within an already-declared
action." A second confirmed instance from a future playtest would justify
either a new structural heuristic for this specific shape or converting it
to a judged (LLM-graded) rubric.
