import { z } from 'zod';

/**
 * The Warden failure modes this milestone builds scripted regression
 * coverage for (M7.4 spec, "Two Assertion Modes", plus `SCENE-JUMP` added
 * afterward — see its own doc comment below). `STATUS-FIELD-OVERLOAD` and
 * `SNAPSHOT-GAP` are deliberately absent — both are direct-fix tickets with
 * no eval coverage, and leaving them out of this enum (rather than including
 * them and simply never implementing a checker) means a fixture can't be
 * authored against a tag nothing will ever check.
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
  'SCENE-JUMP',
]);

export type FailureModeTag = z.infer<typeof failureModeTagSchema>;

/** The five tags checked deterministically, no second LLM call. */
export const structuralFailureModeTags = [
  'OUT-OF-ORDER-RESOLUTION',
  'SYSTEM-ROLLED-PLAYER-ACTION',
  'UNAUDITABLE-MAPPING',
  'MISSING-CANON-CAPTURE',
  'NARRATING-PAST-A-BLOCK',
] as const satisfies readonly FailureModeTag[];

/**
 * The four tags graded by a single Claude Sonnet 5 judge call per fixture.
 * UNSURFACED-CHECK moved here from `structuralFailureModeTags` after a
 * real-run false pass: its regex classifier ("does this roll's purpose text
 * contain a perception-flavored keyword") missed a stakes-gating roll
 * phrased as "Does anything react to Alvarez moving..." — no fixed keyword
 * list can keep pace with arbitrarily-phrased LLM narration of the same
 * underlying question, which a judge call answers directly instead.
 *
 * SCENE-JUMP was added new (not migrated) as a judged-only tag: "did the
 * turn advance the story — new location, new NPC encounter, subsequent plot
 * beats — beyond what the player's stated action justified" is a narrative-
 * causality judgment with no deterministic signal available, the same kind
 * of question UNSURFACED-CHECK's keyword classifier already proved
 * unreliable at. Deliberately kept distinct from OVER-RESOLUTION, which
 * asks a different question (roll granularity/count for content that should
 * stay off-screen) — conflating the two under one tag would blur the
 * per-tag pass-rate summary between two different failure shapes, and
 * violate "one rubric per tag" by making the same tag's fact silently mean
 * different things fixture-to-fixture.
 */
export const judgedFailureModeTags = [
  'HIDDEN-INFO-LEAK',
  'OVER-RESOLUTION',
  'UNSURFACED-CHECK',
  'SCENE-JUMP',
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
  /**
   * Pending `dice_request` rows still open as of the target turn — needed
   * only for fixtures whose `playerInput.type` is `'diceResult'` (the
   * harness resolves one of these against `SessionService.submitDiceResult`
   * rather than seeding a fresh scratch adventure with nothing to resolve).
   * `reconstructStateAsOfTurn` (M7.3) doesn't return this — it's out of
   * that function's scope, not something this milestone revisits — so
   * `capture-fixture` reads it separately, directly from `dice_request`.
   * Empty for `'message'`-type fixtures, which is the common case; defaults
   * to `[]` so fixture files captured before this field existed still
   * parse.
   */
  pendingDiceRequests: z.array(z.record(z.string(), z.unknown())).default([]),
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

/**
 * Describes *what was captured*, not the current checker logic. Bumped only
 * when `capture-fixture` starts recording a field it didn't before (the
 * anticipated case, per spec Part 6, is `rollType` / `gatedByRollId` /
 * `actingEntityId` on `roll_dice`) — never when a checker's interpretation
 * of existing fields changes. A check that needs a field newer fixtures
 * don't yet have declares `requiresFixtureSchema`, and the runner reports
 * `not_applicable` rather than a false regression (see
 * `eval/checks/registry.ts`).
 */
export const FIXTURE_SCHEMA_VERSION = 1;

export const evalFixtureSchema = z
  .object({
    id: z.string().min(1),
    tag: failureModeTagSchema,
    sourceAdventureId: z.string().uuid(),
    /** Traceability back to the original playtest turn this fixture reproduces. */
    sourceSequenceNumber: z.number().int().nonnegative(),
    seededState: seededStateSchema,
    playerInput: playerInputSchema,
    assertion: assertionSchema,
    /** Defaults to `1` so every fixture captured before this field existed
     * still parses unchanged. */
    fixtureSchemaVersion: z
      .number()
      .int()
      .positive()
      .default(FIXTURE_SCHEMA_VERSION),
    /**
     * Per-fixture override of the run's uniform `--reps`, read once at run
     * start and never adjusted mid-run — see `docs/eval-methodology.md`'s
     * adaptive-N hazard. Nothing in this milestone writes this field at
     * runtime; it is hand-authored, the same way `tag` and `assertion` are.
     */
    repOverride: z.number().int().positive().optional(),
  })
  .refine(
    (fixture) =>
      judgedFailureModeTags.includes(
        fixture.tag as (typeof judgedFailureModeTags)[number],
      )
        ? fixture.assertion.mode === 'judged'
        : fixture.assertion.mode === 'structural',
    {
      message:
        "assertion.mode must match the fixture's tag — judged tags " +
        '(HIDDEN-INFO-LEAK, OVER-RESOLUTION, UNSURFACED-CHECK, SCENE-JUMP) ' +
        'require a judged assertion, every other tag requires a structural assertion',
      path: ['assertion', 'mode'],
    },
  );

export type EvalFixture = z.infer<typeof evalFixtureSchema>;
