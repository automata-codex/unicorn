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
    // Known failure: where Petrov is, against the crew roster.
    '2c0ba938-turn24-seeded-canon-contradiction',
    // Known good: Mara's "two decks from me" was correct.
    '2c0ba938-turn29-seeded-canon-contradiction',
  ],
} as const satisfies Record<string, readonly string[]>;

export type QuestionId = keyof typeof CASES;

export function isQuestionId(value: string): value is QuestionId {
  return Object.hasOwn(CASES, value);
}
