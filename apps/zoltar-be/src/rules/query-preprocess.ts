/**
 * Document-frequency term-dropping, applied before every `rules_lookup`
 * embedding call.
 *
 * Shortening a query to its distinctive terms is the single largest
 * retrieval-quality effect measured across the whole investigation — larger
 * than the choice of retrieval backend itself. Trimming the three real
 * recorded Warden queries to 2–3 distinctive terms put the correct page at
 * rank 1 on *both* FTS and dense retrieval, including the one query no other
 * configuration on either backend ever retrieved. See
 * `docs/decisions.md § Query preprocessing for rules_lookup promoted from
 * optional to critical path` and `docs/rules-extraction-findings.md § S4`,
 * `§ S5.3`.
 *
 * The ceiling is computed from the index itself rather than from a
 * hand-authored stopword list: a list would need per-system authoring and
 * tuning, while a document-frequency ceiling derives automatically from
 * whatever `rules_chunk` content exists for the active system, so it
 * generalizes to UVG, OSE, and 5e without new authoring.
 *
 * This module is pure. The frequencies come from the repository; the decision
 * of what to keep is here, so it can be tested without a database.
 */

/**
 * Drop lexemes occurring in more than this share of the active system's
 * chunks.
 *
 * **A proposed starting value, not a measured one.** The investigation showed
 * the qualitative effect — dropping high-frequency terms helps, sometimes
 * substantially — not a tuned cutoff. `task eval:retrieval` is the tool that
 * should sweep it, and treating 0.4 as settled before that sweep would waste
 * the harness's first and easiest use.
 */
export const DEFAULT_DF_THRESHOLD = 0.4;

/**
 * Never trim below this many words. A query preprocessed into an empty string
 * is worse than one that skipped preprocessing entirely.
 */
export const MIN_SURVIVING_WORDS = 2;

/** One content word of the incoming query, with its corpus frequency. */
export interface QueryTerm {
  /** 1-based position in the tokenized query; defines output word order. */
  position: number;
  /** The original word as the user (Warden) wrote it. This is what gets embedded. */
  word: string;
  /** Its stemmed lexeme. This is what decides whether the word survives. */
  lexeme: string;
  /** Share of the system's chunks containing the lexeme, 0..1. */
  documentFrequency: number;
}

export interface PreprocessOptions {
  threshold?: number;
  minWords?: number;
}

export interface PreprocessResult {
  /** The string to embed. Equal to the input when nothing was dropped. */
  query: string;
  /** Words removed, in their original order. Empty when nothing was dropped. */
  dropped: string[];
  /** False when the query was passed through untouched. */
  applied: boolean;
  /** Why preprocessing did nothing, when it did nothing. */
  skipReason?: 'no-indexable-terms' | 'nothing-above-threshold' | 'below-floor';
}

/**
 * Choose which of a query's words to embed.
 *
 * Rebuilds from **surviving original words, not surviving lexemes**. The
 * lexeme decides whether a word survives; what gets embedded is the word the
 * Warden actually wrote. Handing Voyage a bag of stems (`"perceiv notic
 * environ"`) is not natural language and is not what any measured improvement
 * came from — every gain in `§ S4`/`§ S5.3` came from trimming a real
 * sentence to its distinctive words, not from stemming it.
 *
 * @param original the raw query, returned unchanged whenever nothing is dropped
 * @param terms    content words with frequencies, from `RulesRepository`
 */
export function preprocessQuery(
  original: string,
  terms: QueryTerm[],
  options: PreprocessOptions = {},
): PreprocessResult {
  const threshold = options.threshold ?? DEFAULT_DF_THRESHOLD;
  const minWords = options.minWords ?? MIN_SURVIVING_WORDS;

  // No indexable content words: an all-stopword query, or an empty corpus
  // whose frequencies are meaningless. Either way, leave the query alone —
  // there is nothing to decide with.
  if (terms.length === 0) {
    return {
      query: original,
      dropped: [],
      applied: false,
      skipReason: 'no-indexable-terms',
    };
  }

  const byPosition = [...terms].sort((a, b) => a.position - b.position);
  let kept = byPosition.filter((term) => term.documentFrequency <= threshold);
  let skipReason: PreprocessResult['skipReason'];

  if (kept.length === byPosition.length) {
    // Every term is distinctive enough to keep. Return the original rather
    // than a rebuilt-from-tokens version: rebuilding would strip punctuation
    // and stopwords for no retrieval benefit, and would make the telemetry
    // read as though preprocessing had done something.
    return {
      query: original,
      dropped: [],
      applied: false,
      skipReason: 'nothing-above-threshold',
    };
  }

  if (kept.length < minWords) {
    // Everything (or nearly everything) cleared the ceiling. Keep the least
    // frequent words rather than trimming to nothing — the floor exists
    // precisely for a query made entirely of common terms.
    kept = [...byPosition]
      .sort(
        (a, b) =>
          a.documentFrequency - b.documentFrequency || a.position - b.position,
      )
      .slice(0, Math.min(minWords, byPosition.length))
      .sort((a, b) => a.position - b.position);
    skipReason = 'below-floor';
  }

  const keptPositions = new Set(kept.map((term) => term.position));
  const dropped = byPosition
    .filter((term) => !keptPositions.has(term.position))
    .map((term) => term.word);

  if (dropped.length === 0) {
    return {
      query: original,
      dropped: [],
      applied: false,
      skipReason: skipReason ?? 'nothing-above-threshold',
    };
  }

  return {
    query: kept.map((term) => term.word).join(' '),
    dropped,
    applied: true,
    skipReason,
  };
}
