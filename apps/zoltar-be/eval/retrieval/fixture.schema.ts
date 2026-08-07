import { z } from 'zod';

/**
 * How the query was phrased. **Load-bearing, not decoration.**
 *
 * The only `rules_lookup` queries the Warden has ever actually produced are
 * keyword-stuffed and fuzzy — `"perception check looking around environment,
 * noticing details"` — nothing like a crisp human question. A fixture set of
 * only well-formed questions would measure a query distribution the Warden
 * does not generate, and would report a quality bar its real queries never
 * clear.
 *
 * Carry both, tagged, and report their rates separately: an index that scores
 * well on `authored` and badly on `warden-observed` is the actionable
 * finding, and a single blended number hides it. `docs/roadmap.md` M7.5 and
 * the M7.5 spec both require separate targets per style.
 */
export const queryStyleSchema = z.enum(['authored', 'warden-observed']);

export type QueryStyle = z.infer<typeof queryStyleSchema>;

/**
 * One page-labeled retrieval query.
 *
 * **Labeled by page, not by chunk id.** This is the decision that determines
 * whether the fixture set survives M7.5 at all: chunk ids are regenerated on
 * every ingestion (`DELETE` then re-`INSERT` against `gen_random_uuid()`), so
 * an id-labeled set would die at the first re-chunk — exactly when it is
 * needed. Page numbers are stable across chunking changes, and the pipeline's
 * footer-derived `source` string is what makes them readable back out.
 *
 * Fixtures are queries and page numbers, no rules text, so they belong in
 * version control under the same posture as the fixup files
 * (`docs/rules-ingestion.md § Licensing Posture`).
 */
export const retrievalFixtureSchema = z
  .object({
    id: z.string().min(1),
    /** `game_system.slug`. Lets one file hold more than one system's queries. */
    system: z.string().min(1),
    query: z.string().min(1),
    queryStyle: queryStyleSchema,
    /**
     * Printed page numbers that answer the query. An array because a topic can
     * span pages; recall counts a hit if **any** listed page comes back, not
     * all of them.
     */
    expectedPages: z.array(z.number().int().positive()),
    /** Chapter name, for a human auditing why a fixture reads as it does. Not scored. */
    expectedChapter: z.string().optional(),
    /**
     * False for the deliberately-unanswerable set. Those are not filler:
     * without them recall looks excellent and teaches nothing about false
     * confidence, and there is no material at all for the similarity-floor
     * question M7.5 has to answer.
     */
    answerable: z.boolean(),
    /** The M7.4 failure-mode tag this query was sampled from. Drives the per-tag rollup. */
    sourceTag: z.string().optional(),
    /** Free-text provenance — "hand-authored", or the fixture family it came from. Not scored. */
    source: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((fixture, ctx) => {
    // Fail closed. A stub emitted by `sample-retrieval-fixtures.ts` carries
    // `expectedPages: null` and `answerable: null` and fails to parse at the
    // type level; these two rules catch the subtler half-edited cases, where
    // someone set `answerable` and forgot the pages or the reverse. An
    // unlabeled fixture that scored as answerable would quietly depress
    // recall and look like an index problem.
    if (fixture.answerable && fixture.expectedPages.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedPages'],
        message:
          'an answerable fixture needs at least one expected page — label it, or set answerable: false',
      });
    }
    if (!fixture.answerable && fixture.expectedPages.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedPages'],
        message:
          'an unanswerable fixture must have no expected pages — it is scored only for its top-1 similarity',
      });
    }
  });

export type RetrievalFixture = z.infer<typeof retrievalFixtureSchema>;
