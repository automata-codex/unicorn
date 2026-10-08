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
