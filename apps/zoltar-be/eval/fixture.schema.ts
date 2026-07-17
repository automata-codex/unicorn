import { z } from 'zod';

/**
 * The eight Warden failure modes this milestone builds scripted regression
 * coverage for (M7.4 spec, "Two Assertion Modes"). `STATUS-FIELD-OVERLOAD`
 * and `SNAPSHOT-GAP` are deliberately absent — both are direct-fix tickets
 * with no eval coverage, and leaving them out of this enum (rather than
 * including them and simply never implementing a checker) means a fixture
 * can't be authored against a tag nothing will ever check.
 */
export const failureModeTagSchema = z.enum([
  'OUT-OF-ORDER-RESOLUTION',
  'SYSTEM-ROLLED-PLAYER-ACTION',
  'UNAUDITABLE-MAPPING',
  'MISSING-CANON-CAPTURE',
  'NARRATING-PAST-A-BLOCK',
  'UNSURFACED-CHECK',
  'HIDDEN-INFO-LEAK',
  'OVER-RESOLUTION',
]);

export type FailureModeTag = z.infer<typeof failureModeTagSchema>;

/** The six tags checked deterministically, no second LLM call. */
export const structuralFailureModeTags = [
  'OUT-OF-ORDER-RESOLUTION',
  'SYSTEM-ROLLED-PLAYER-ACTION',
  'UNAUDITABLE-MAPPING',
  'MISSING-CANON-CAPTURE',
  'NARRATING-PAST-A-BLOCK',
  'UNSURFACED-CHECK',
] as const satisfies readonly FailureModeTag[];

/** The two tags graded by a single Claude Sonnet 5 judge call per fixture. */
export const judgedFailureModeTags = [
  'HIDDEN-INFO-LEAK',
  'OVER-RESOLUTION',
] as const satisfies readonly FailureModeTag[];

/**
 * `campaignState`/`gmContextBlob`/`pendingCanon`/`messages` are captured
 * once at fixture-authoring time by `capture-fixture` (a thin wrapper
 * around M7.3's `reconstructStateAsOfTurn`) and written into the fixture
 * file as literal, static JSON — not a live reference the harness
 * re-derives at eval-run time. Because JSON is the on-disk representation,
 * these are validated only loosely here (records/arrays of unknown shape,
 * not `MothershipCampaignState`/`PendingCanonRow`/`DbMessage` themselves —
 * those Zod schemas expect JS `Date` objects and branded types that don't
 * survive a JSON round-trip losslessly). Deep validation happens later,
 * against the actual `MothershipCampaignState` schema and friends, when the
 * harness seeds a scratch adventure from this data (Part 3) — that's the
 * layer that actually needs the shape to be right to seed real DB rows;
 * this layer only needs enough structure to know a fixture file is a
 * fixture file.
 */
const seededStateSchema = z.object({
  campaignState: z.record(z.string(), z.unknown()),
  gmContextBlob: z.record(z.string(), z.unknown()),
  pendingCanon: z.array(z.record(z.string(), z.unknown())),
  messages: z.array(z.record(z.string(), z.unknown())),
  /** Provenance only — never read at eval-run time. */
  capturedAt: z.string(),
});

const playerInputSchema = z.object({
  type: z.enum(['message', 'diceResult']),
  content: z.string(),
});

/**
 * `check` (structural) and `rubric` (judged) are deliberately typed as
 * plain strings, matching the spec's literal `EvalFixture` interface — but
 * neither is parsed or executed. The spec is explicit that there is one
 * structural checker and one judge rubric *per tag*, not per fixture, so
 * the actual checker/rubric is selected by `tag` through a registry
 * (`eval/checks/structural/registry.ts`, `eval/checks/judged/rubrics.ts`).
 * `check` is carried through verbatim into the report's "Expected: ..."
 * line — free-text documentation of intent, authored by whoever writes the
 * fixture. `rubric` is a rubric-template identifier looked up in the judged
 * registry (starting 1:1 with `tag`, free to diverge later if a rubric
 * needs versioning without touching every fixture referencing it).
 */
const structuralAssertionSchema = z.object({
  mode: z.literal('structural'),
  check: z.string(),
});

const judgedAssertionSchema = z.object({
  mode: z.literal('judged'),
  rubric: z.string(),
  facts: z.record(z.string(), z.string()),
});

const assertionSchema = z.discriminatedUnion('mode', [
  structuralAssertionSchema,
  judgedAssertionSchema,
]);

export type Assertion = z.infer<typeof assertionSchema>;

export const evalFixtureSchema = z.object({
  id: z.string().min(1),
  tag: failureModeTagSchema,
  sourceAdventureId: z.string().uuid(),
  /** Traceability back to the original playtest turn this fixture reproduces. */
  sourceSequenceNumber: z.number().int().nonnegative(),
  seededState: seededStateSchema,
  playerInput: playerInputSchema,
  assertion: assertionSchema,
});

export type EvalFixture = z.infer<typeof evalFixtureSchema>;
