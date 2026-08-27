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
  // Added by M7.6, which is the first milestone whose pool writes carry a
  // stated reason and whose damage can run a multi-step chain.
  'UNEXPLAINED-DELTA',
  'CARRYOVER-ARITHMETIC',
  // Added by M7.7. Unlike every tag above it, no fixture is ever *tagged*
  // this — its check is universal and attaches to all of them (see
  // `universalCheckIds` in `eval/checks/registry.ts`). The tag exists
  // because `buildChecks` derives the registry from these lists, and a
  // check outside them would be a second way to register one.
  'TOOL-SYNTAX-LEAK',
  // Added by M7.7's second playtest (adventure `5c34991b`), which surfaced
  // both. **Both ship with a stub checker** (`eval/checks/structural/
  // unimplemented.ts`) that grades nothing — the tags exist so the turns
  // that provoke them could be captured as fixtures against the live
  // adventure, rather than after the checkers are designed and the DB has
  // moved on. This is a deliberate, temporary exception to the rule stated
  // at the top of this enum, and it is enforced rather than trusted:
  // `assertNoStubCheckers` (`eval/preflight.ts`) refuses to start any run
  // whose selected fixtures carry a stub, so a stubbed tag cannot reach a
  // score row. That refusal is not skippable and is currently in force for
  // the whole corpus — see its doc comment before reaching for `--fixtures`.
  'MISSING-DELTA',
  'ROLL-RESULT-INVERSION',
  // Added by M7.8 for `ADR-0100`'s Contractor rules, which shipped in M7.7
  // and were graded by nothing. Named for the target rather than the skill:
  // the subject is a roll target that does not follow from the entity's
  // sheet, of which a misapplied skill bonus is only one of three ways.
  'UNGROUNDED-CONTRACTOR-TARGET',
  // Added by M7.8 for `ADR-0104`. Its sibling `SPATIAL-RELATION-ERROR` is
  // deliberately absent: that ADR's addendum defers registration because the
  // structural/judged choice is the unsettled question, and registering forces
  // it now. While it stays unregistered `capture-fixture` refuses `--tag
  // SPATIAL-RELATION-ERROR` outright, which is a mechanical guardrail that
  // registering would replace with a note asking people to remember.
  'SEEDED-CANON-CONTRADICTION',
]);

export type FailureModeTag = z.infer<typeof failureModeTagSchema>;

/** The tags checked deterministically, no second LLM call. */
export const structuralFailureModeTags = [
  'OUT-OF-ORDER-RESOLUTION',
  'SYSTEM-ROLLED-PLAYER-ACTION',
  'MISSING-CANON-CAPTURE',
  // Every input and the result live in event and state structure, so no prose
  // classification is needed — `decisions.md § A structural check may read
  // event and state structure; it may not classify prose`.
  'CARRYOVER-ARITHMETIC',
  'TOOL-SYNTAX-LEAK',
  // `MISSING-DELTA` and `ROLL-RESULT-INVERSION` sat here as stubs, listed
  // structural so a placeholder rubric could never reach a paid judge call.
  // The note flagged the eventual mode as open — "both questions have a
  // prose half" — and on 2026-08-20 both moved to `judgedFailureModeTags`,
  // the third such migration after `UNSURFACED-CHECK` and
  // `NARRATING-PAST-A-BLOCK`.
] as const satisfies readonly FailureModeTag[];

/**
 * The tags graded by a Claude Sonnet 5 judge call per fixture.
 *
 * NARRATING-PAST-A-BLOCK moved here from `structuralFailureModeTags` after
 * the same class of false FAIL that forced UNSURFACED-CHECK across, twice
 * over: its resolution-language regex read the Warden's standard, correct
 * way of stating a pending roll's stakes ("if you hit, you deal 10 damage")
 * as evidence the roll had already resolved. A sentence-scoped `\bif\b`
 * guard was added to fix exactly that, and the pattern then failed the same
 * way on commitment language ("you put two rounds into...") — prose stating
 * what the character is doing, not what the dice decided. "Did the narration
 * stop where it should have" is a question about meaning, and the checker's
 * own doc comment had flagged it as the weakest of the structural rules from
 * the day it was written.
 *
 * It keeps a structural pre-filter (`judgeGate`, `eval/checks/registry.ts`)
 * for the one part of the question structure can answer — see
 * `narrating-past-a-block.ts`.
 *
 * UNAUDITABLE-MAPPING moved here for the same reason and is the clearest
 * case of the hybrid shape: its structural half decides *which* rolls are
 * spontaneous GM-side choices (a matter of `rollSource`, `requestId`,
 * `modifier` and notation, entirely non-lexical), and only the semantic
 * residual — does the roll's stated purpose enumerate outcomes covering the
 * die's range — reaches the rubric. Its regex predecessor reached a verdict
 * on 15 of 20 reps under 4.6 and 4 of 20 under Sonnet 5 against an
 * unchanged prompt; the structural classifier reaches one on 20 of 20 and
 * 16 of 20, and the remaining four are turns that rolled nothing at all.
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
  'NARRATING-PAST-A-BLOCK',
  'UNAUDITABLE-MAPPING',
  // Whether a `reason` explains its delta is a question about meaning, not
  // structure: the field's presence is enforced by the tool schema, so a
  // structural check could only ever confirm what parsing already did.
  'UNEXPLAINED-DELTA',
  // Both arrived stubbed with the 2026-08-16 playtest and were made judged
  // on 2026-08-20, after establishing that neither is structurally
  // checkable as the turn is recorded today.
  //
  // MISSING-DELTA compares what the narration says happened against what
  // `stateChanges` actually carries — narrated intent versus emitted change,
  // which is a question about meaning. A structural version could compare
  // known flag ids found in the notes against `flagTriggers`, but that
  // covers only the flag case while the tag's name promises pool and
  // character-state omissions too: a rate that reads as coverage it does
  // not have, which is the shape `ADR-0096` closed.
  //
  // ROLL-RESULT-INVERSION needs a roll's *target* and the Warden's
  // *adjudication*. `DiceRollEventPayload` carries neither — the target
  // survives only as free text inside `purpose`, the adjudication only in
  // `playerText`. The alternatives were parsing `purpose` (the
  // pattern-matching this file's `system-rolled-player-action` already has
  // a false-PASS burn from) or recording target and outcome on the roll
  // event, which is a Warden-visible turn-schema change.
  'MISSING-DELTA',
  'ROLL-RESULT-INVERSION',
  //
  // UNGROUNDED-CONTRACTOR-TARGET is judged for both of the reasons above at
  // once. It needs a roll's target, which `DiceRollEventPayload` does not
  // carry and `purpose` holds only as free text — the same wall
  // ROLL-RESULT-INVERSION hit. And one of its three violations turns on
  // whether the check falls inside a mapped skill's domain, a judgment about
  // what "cracking an encoded file" or "hauling a coupling clear" is *for*:
  // prose classification, and so barred from a structural check outright.
  //
  // The third violation — a target matching none of the entity's derived
  // numbers — needs no domain judgment and would be structural if the target
  // were a field. It is not, so the whole check goes to the judge rather than
  // splitting one question across two modes.
  //
  // It keeps a structural pre-filter for the half structure can answer —
  // whether any roll this turn was made by a crewRole-bearing entity — which
  // is an id lookup against seeded state and entirely non-lexical. See
  // `ungrounded-contractor-target.ts`.
  'UNGROUNDED-CONTRACTOR-TARGET',
  //
  // SEEDED-CANON-CONTRADICTION is judged because extracting the assertion from
  // narration is classification: "you climb down toward the deck below" has to
  // be read as a claim about which deck a place is on before it can be
  // compared to anything. The comparison itself would be trivial; getting the
  // claim out of the prose is the whole difficulty.
  //
  // Its scope is deliberately wider than the spatial cases that produced it.
  // The unifying property is not that a claim is spatial but that its referent
  // lives in the fixture, which is what makes the tag gradeable at all — the
  // reason `ADR-0104` splits one finding into this tag and a deferred sibling
  // that reasons about positions state does not record.
  'SEEDED-CANON-CONTRADICTION',
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
 * Whether a check's failure mode is even in play for this fixture's
 * scenario — authored once at fixture-capture time, never inferred at
 * eval-run time from what the model happened to produce (the bug this
 * schema exists to prevent: gating on a `dice_roll` event's presence
 * selects on the model's own choice, not the situation). Keyed by check id
 * (`eval/checks/registry.ts`'s `toCheckId(tag)`, e.g.
 * `'system-rolled-player-action'`), not nested under `assertion`, because a
 * fixture can carry more than one check with different applicability —
 * `selectChecksForFixture` returns an array for this reason.
 *
 * **This map is now what attaches a tag-independent check to a fixture, not
 * just what gates one.** A key naming a tag-independent check
 * (`EvalCheck.tagIndependent`) puts that check on this fixture whatever the
 * fixture's own `tag` says; the three `turn24-*` fixtures carry
 * `system-rolled-player-action` this way. Selection throws on a key naming
 * anything else, so a typo is loud rather than a silently-unclosed coverage
 * hole. See `eval/checks/registry.ts`.
 *
 * `situation` does double duty: for `applies: true` it documents why the
 * checker should engage (audit trail, not read by any checker); for
 * `applies: false` it's the check's `NOT_APPLICABLE` reason, so it must
 * describe the *scenario* not calling for the check, never a model-produced
 * artifact ("no dice_roll events this turn" is exactly the phrasing this
 * field replaces).
 */
const applicabilityEntrySchema = z.discriminatedUnion('applies', [
  z.object({
    applies: z.literal(true),
    /** The fixture's own name for the player entity this check should
     * attribute rolls/requests to — replaces the harness's old
     * `campaignState.resourcePools`-key-guessing heuristic. */
    playerEntity: z.string().min(1),
    situation: z.string().min(1),
  }),
  z.object({
    applies: z.literal(false),
    situation: z.string().min(1),
  }),
]);

export type ApplicabilityEntry = z.infer<typeof applicabilityEntrySchema>;

const applicabilitySchema = z.record(z.string(), applicabilityEntrySchema);

export type Applicability = z.infer<typeof applicabilitySchema>;

/**
 * Describes *what was captured*, not the current checker logic. Bumped only
 * when `capture-fixture` starts recording a field it didn't before — v2
 * added `applicability` (see above) — never when a checker's interpretation
 * of existing fields changes. A check that needs a field newer fixtures
 * don't yet have declares `requiresFixtureSchema`, and the runner reports
 * `not_applicable` rather than a false regression (see
 * `eval/checks/registry.ts`).
 */
export const FIXTURE_SCHEMA_VERSION = 2;

/**
 * The version every fixture predating this field is deemed to be — frozen
 * at `1` forever, deliberately NOT `FIXTURE_SCHEMA_VERSION`. A fixture file
 * with the field literally absent from its JSON never had ANY version
 * stamped on it, v1 or otherwise; a default that tracked the current
 * constant would make every future bump retroactively (and silently) claim
 * those fixtures carry whatever the new version's fields are, defeating the
 * exact purpose `requiresFixtureSchema`'s gate exists for.
 */
const LEGACY_FIXTURE_SCHEMA_VERSION = 1;

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
    /** Fixture-authored per check id — absent (or an entry missing for a
     * given check id) means that check's situation was never assessed for
     * this fixture, which `requiresFixtureSchema`'s gate treats as
     * `not_applicable` rather than assuming either way. */
    applicability: applicabilitySchema.optional(),
    /** Defaults to `1` so every fixture captured before this field existed
     * still parses unchanged. */
    fixtureSchemaVersion: z
      .number()
      .int()
      .positive()
      .default(LEGACY_FIXTURE_SCHEMA_VERSION),
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
        `(${judgedFailureModeTags.join(', ')}) require a judged assertion, ` +
        'every other tag requires a structural assertion',
      path: ['assertion', 'mode'],
    },
  );

export type EvalFixture = z.infer<typeof evalFixtureSchema>;
