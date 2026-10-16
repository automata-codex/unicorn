/**
 * Which fixtures each question is asked of. The questions themselves live in
 * `$ZOLTAR_EVAL_ROOT/eval-v2-runs/README.md`; the text here is a copy for
 * whoever is reading the list.
 */
export const CASES = {
  // Does the Warden get descriptions of characters, places, and timelines
  // correct against the seeded world facts and opening narration for labeled
  // cases on at least 90% of reps per case?
  q1: [
    // Known failure: mid-deck lighting out "since day four", against the
    // opening narration's "two nights ago".
    '2c0ba938-turn01-seeded-canon-contradiction',
    // Known failures: wrong deck for the records terminal and the crew berths.
    '2c0ba938-turn08-seeded-canon-contradiction',
    '2c0ba938-turn14-seeded-canon-contradiction',
    '2c0ba938-turn18-seeded-canon-contradiction',
    // Constructed from turn 18, to ask whether its failure is inherited from
    // the session's own narration. Two sentences of the seeded history are
    // changed and nothing else: message 28 walks to Mara's berth along
    // mid-deck where the session climbed down to the lower deck, and message
    // 26 has her start toward the crew berths, not the ladder shaft.
    '2c0ba938-turn18-berth-corrected',
    // Constructed from turn 18, to ask whether a correction in the history
    // outweighs the error it corrects. Message 28's error is left in. Two
    // messages are added after message 30 and nothing else changes: the
    // player asks which deck the berth is on, and the Warden says mid-deck
    // and that it had it wrong. Both are written by hand, on the pattern of
    // the session's own messages 17 and 18.
    '2c0ba938-turn18-berth-retracted',
    // The retracted case with the history's repeats taken out and nothing
    // else changed. The session holds its opening OOC question twice, and
    // the patch-kit message four times with two Warden replies to it. One
    // copy of each player message is kept, and the later Warden reply.
    '2c0ba938-turn18-berth-retracted-tidy',
    // The tidy retracted case with one world fact added and nothing else
    // changed: `danny_location`, "At the cryo bay bulkhead, on mid-deck."
    // It stands in for a recorded position (`ADR-0101`), seeded by hand, to
    // ask whether the Warden follows one before any way to write it is built.
    '2c0ba938-turn18-position-seeded',
    // The tidy retracted case with one sentence changed and nothing else, and
    // no location fact. The Warden message before the turn brought Danny back
    // from the stores in two words ("Back up at the cryo bay bulkhead"); here
    // it says he climbs back up the ladder shaft to mid-deck, Deck 2.
    '2c0ba938-turn18-return-stated',
    // Two arms that ask whether one hand-written sentence is why the
    // retraction cases open "You head back up to mid-deck" (eval-findings
    // S59, S60). The sentence is "So: you're both on mid-deck, in Mara's
    // berth, with the lower deck and the engine room one level below you."
    // Removed: the tidy retracted case without it. Added: the corrected case
    // with it appended to message 28, where Danny arrives at the berth.
    '2c0ba938-turn18-retracted-sentence-removed',
    '2c0ba938-turn18-corrected-sentence-added',
    // Known failure: where Petrov is, against the crew roster.
    '2c0ba938-turn24-seeded-canon-contradiction',
    // Known good: Mara's "two decks from me" was correct.
    '2c0ba938-turn29-seeded-canon-contradiction',
    // Turns 14, 24 and 29 as captured, each with one world fact added and
    // nothing else changed: `danny_location`, holding the start Rubric v3
    // gives for that turn. They stand in for a position the Warden would have
    // recorded, to ask whether it starts a move from one when the prompt
    // names the fact (eval-findings S74). Turn 24's value follows the seeded
    // layout ("In Mara's berth, on mid-deck."), not the session's history,
    // which has the berth on the lower deck.
    '2c0ba938-turn14-position-seeded',
    '2c0ba938-turn24-position-seeded',
    '2c0ba938-turn29-position-seeded',
  ],
  // When damage takes a character to zero Health, does the Warden record the
  // Wound as `delta: +1` on `wounds` (never `maxDelta`), with a `damageType`
  // on the damage delta and a Health reset in the same response?
  q2: [
    // Constructed from `turn28-hidden-info-leak` (session 18be155e, the only
    // one with a firefight), to reach the turn after it. In the session that
    // turn took Alvarez below zero Health, and the July Warden wrote hp -1
    // and called for a Death Save. Two messages are added, both the
    // session's own, copied from the 2026-07-16 database backup: the Warden's
    // reply to the turn 28 question, and the player's turn 29 message, which
    // is the input. One number is changed: Alvarez's Health, 20 to 4. The
    // captured 20 disagrees with the session, whose turn 28 reply says "7 HP"
    // and whose turn 29 state change (-1 after 5 damage) implies 4. Nothing
    // else in the state is touched, so her armor is whole and her Wounds are
    // 0 of 3. A rep where no hit takes her to zero asks nothing: mark it na.
    '18be155e-turn29-wounds-chain',
  ],
} as const satisfies Record<string, readonly string[]>;

export type QuestionId = keyof typeof CASES;

export function isQuestionId(value: string): value is QuestionId {
  return Object.hasOwn(CASES, value);
}
