import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Scores the `rules_lookup` queries a Warden actually emitted against the
 * vocabulary the rules corpus actually contains.
 *
 * **Why this is not `task eval:retrieval`.** That harness scores *frozen
 * fixture queries* against the index, so it can measure the index and cannot
 * measure the Warden. M7.5 Part 4.6's two levers — vocabulary bridging and
 * the mechanical-model primer — change the *distribution of queries the
 * Warden emits*, which a fixed query set is structurally blind to. This
 * scores the other side.
 *
 * **Where the queries come from, and why it costs nothing.**
 * `warden-output.json` is the full serialized `TurnExecutionResult`, whose
 * `telemetry` field is the `adventure_telemetry` row, whose
 * `payload.rulesLookups` records the query text of every `rules_lookup` call
 * in that turn. So every eval run ever completed already contains its own
 * query corpus, and the before-number for a prompt change is available from
 * artifacts on disk rather than from a fresh run.
 *
 * The empty index of the pre-M7.2 baselines is no obstacle:
 * `RulesLookupService.lookup()` embeds and queries regardless of whether the
 * index has rows, deliberately, because "every lookup attempt is telemetry
 * input for ingestion prioritization."
 *
 * **What is measured, and what is not.** This computes the mechanical half of
 * `docs/rules-extraction-findings.md § S9`'s method: the share of emitted
 * queries carrying at least one term absent from the corpus. The split of
 * that share into *wrong word* (a synonym layer would fix it) versus
 * *concept absent* (nothing can, because the book has no such rule) is a
 * hand audit over the distinct absent terms — small, since S9 found 100
 * distinct terms across 596 queries — and it stays a paragraph of judgement
 * in a findings session rather than a number this file invents.
 */

/** One `rules_lookup` call, with enough provenance to find it again. */
export interface HarvestedQuery {
  query: string;
  fixtureId: string;
  rep: string;
}

/**
 * The shape `warden-output.json` exposes that this scorer needs. Deliberately
 * partial and defensive: an artifact whose turn never reached
 * `applyTurnAtomic` has `telemetry: null` (the `diceResult` path without
 * auto-advance writes no row), and older artifacts may carry no
 * `rulesLookups` key at all.
 */
interface WardenOutputShape {
  telemetry?: { payload?: { rulesLookups?: Array<{ query?: string }> } } | null;
}

/**
 * Pull every `rules_lookup` query out of an `eval:run` directory.
 *
 * Walks `reps/<rep>/<fixture>/warden-output.json`. A missing or malformed
 * artifact is skipped rather than fatal — a run can legitimately contain a
 * fixture that errored, and refusing to score the other 145 because of it
 * would make this unusable on exactly the runs worth looking at.
 */
export async function harvestQueries(
  runDir: string,
): Promise<HarvestedQuery[]> {
  const repsDir = join(runDir, 'reps');
  let reps: string[];
  try {
    reps = (await readdir(repsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    throw new Error(`no reps/ directory under ${runDir}`);
  }

  const harvested: HarvestedQuery[] = [];

  for (const rep of reps) {
    const repDir = join(repsDir, rep);
    const fixtures = (await readdir(repDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const fixtureId of fixtures) {
      let parsed: WardenOutputShape;
      try {
        parsed = JSON.parse(
          await readFile(join(repDir, fixtureId, 'warden-output.json'), 'utf8'),
        ) as WardenOutputShape;
      } catch {
        continue;
      }
      for (const lookup of parsed.telemetry?.payload?.rulesLookups ?? []) {
        if (typeof lookup.query === 'string' && lookup.query.trim()) {
          harvested.push({ query: lookup.query, fixtureId, rep });
        }
      }
    }
  }

  return harvested;
}

/** One query's verdict. */
export interface ScoredQuery {
  query: string;
  /** Distinct corpus-absent lexemes, in query order. Empty means in-corpus. */
  absentTerms: string[];
  /** The surface words those lexemes came from, for the hand audit. */
  absentWords: string[];
  occurrences: number;
}

export interface QueryVocabMetrics {
  /** Distinct queries scored. */
  distinctQueries: number;
  /** Total `rules_lookup` calls, counting repeats. */
  totalLookups: number;
  /** Distinct queries carrying at least one corpus-absent term. */
  outOfCorpusQueries: number;
  /**
   * `outOfCorpusQueries / distinctQueries`, or `null` when nothing was
   * scored. **Null rather than zero**: an undefined rate is a real state, and
   * rendering it as 0% would read as a perfect score on a run that made no
   * lookups at all.
   */
  outOfCorpusRate: number | null;
  /** Same rate weighted by how often each query was actually issued. */
  weightedOutOfCorpusRate: number | null;
  /** Distinct absent lexemes across the whole set, most frequent first. */
  absentTermCounts: Array<{ term: string; queries: number; words: string[] }>;
}

/**
 * A term's document frequency within the corpus, as
 * `RulesRepository.queryTermFrequencies` returns it.
 */
export interface TermFrequency {
  word: string;
  lexeme: string;
  documentFrequency: number;
}

/**
 * Resolves a query's terms against the corpus. Injected so this module stays
 * unit-testable with no database — the Postgres text-search call is the one
 * part of this file that is not.
 */
export type TermLookup = (query: string) => Promise<TermFrequency[]>;

/**
 * A term is corpus-absent when it matches **zero** chunks.
 *
 * `documentFrequency` is `matches / total_chunks`, so `0` means "no chunk in
 * the index contains this lexeme" — which is exactly the question, and is not
 * a threshold to be tuned. Anything above zero is present, however rare.
 *
 * **The `§ S9.1` hazard this avoids.** `queryTermFrequencies` matches with
 * `plainto_tsquery('simple', lexeme)` on lexemes `ts_debug` has *already*
 * stemmed. Re-stemming them — which `to_tsquery('english', …)` would do —
 * turns `surpris` into `surpri` and `oppos` into `oppo`, so a term fails to
 * match its own tsvector entry and reports as absent from the book it is
 * printed in. That bug cost S8 three false absents before it was found, and
 * it is silent: the numbers stay plausible.
 */
function isAbsent(term: TermFrequency): boolean {
  return term.documentFrequency === 0;
}

export async function scoreQueries(
  harvested: HarvestedQuery[],
  lookupTerms: TermLookup,
): Promise<{ scored: ScoredQuery[]; metrics: QueryVocabMetrics }> {
  const occurrences = new Map<string, number>();
  for (const item of harvested) {
    occurrences.set(item.query, (occurrences.get(item.query) ?? 0) + 1);
  }

  const scored: ScoredQuery[] = [];
  // Distinct queries only — the same phrasing repeated across reps resolves
  // to the same terms, and scoring it twice would just make whichever query
  // the model happened to repeat dominate the rate.
  for (const [query, count] of [...occurrences.entries()].sort()) {
    const terms = await lookupTerms(query);
    const absent = terms.filter(isAbsent);
    scored.push({
      query,
      absentTerms: [...new Set(absent.map((t) => t.lexeme))],
      absentWords: [...new Set(absent.map((t) => t.word))],
      occurrences: count,
    });
  }

  return { scored, metrics: computeMetrics(scored) };
}

export function computeMetrics(scored: ScoredQuery[]): QueryVocabMetrics {
  const outOfCorpus = scored.filter((row) => row.absentTerms.length > 0);
  const totalLookups = scored.reduce((sum, row) => sum + row.occurrences, 0);
  const outOfCorpusLookups = outOfCorpus.reduce(
    (sum, row) => sum + row.occurrences,
    0,
  );

  const byTerm = new Map<string, { queries: number; words: Set<string> }>();
  for (const row of scored) {
    row.absentTerms.forEach((term, index) => {
      const entry = byTerm.get(term) ?? { queries: 0, words: new Set() };
      entry.queries += 1;
      const word = row.absentWords[index];
      if (word) entry.words.add(word);
      byTerm.set(term, entry);
    });
  }

  return {
    distinctQueries: scored.length,
    totalLookups,
    outOfCorpusQueries: outOfCorpus.length,
    outOfCorpusRate:
      scored.length === 0 ? null : outOfCorpus.length / scored.length,
    weightedOutOfCorpusRate:
      totalLookups === 0 ? null : outOfCorpusLookups / totalLookups,
    absentTermCounts: [...byTerm.entries()]
      .map(([term, entry]) => ({
        term,
        queries: entry.queries,
        words: [...entry.words].sort(),
      }))
      .sort((a, b) => b.queries - a.queries || a.term.localeCompare(b.term)),
  };
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

export function renderQueryVocabReport(args: {
  runDir: string;
  system: string;
  chunkCount: number;
  scored: ScoredQuery[];
  metrics: QueryVocabMetrics;
}): string {
  const { metrics } = args;
  const lines: string[] = [];

  lines.push('# rules_lookup query vocabulary');
  lines.push('');
  lines.push(`- Run: ${args.runDir}`);
  lines.push(`- Corpus: ${args.chunkCount} chunks for "${args.system}"`);
  lines.push('');
  lines.push(
    'Measures the **queries the Warden emitted**, not the index. A term is',
  );
  lines.push(
    'corpus-absent when it matches zero chunks. This is the mechanical half',
  );
  lines.push(
    'of `docs/rules-extraction-findings.md § S9`; splitting the absent terms',
  );
  lines.push(
    'into *wrong word* and *concept absent* is a hand audit over the table at',
  );
  lines.push('the end, not something this report decides.');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Distinct queries | ${metrics.distinctQueries} |`);
  lines.push(`| Total lookups | ${metrics.totalLookups} |`);
  lines.push(
    `| Queries with an out-of-corpus term | ${metrics.outOfCorpusQueries} |`,
  );
  lines.push(
    `| **Out-of-corpus rate** | **${pct(metrics.outOfCorpusRate)}** |`,
  );
  lines.push(
    `| Out-of-corpus rate, weighted by lookups | ${pct(metrics.weightedOutOfCorpusRate)} |`,
  );

  lines.push('');
  lines.push('## Absent terms');
  lines.push('');
  if (metrics.absentTermCounts.length === 0) {
    lines.push('None — every emitted query is entirely in corpus vocabulary.');
  } else {
    lines.push('| lexeme | queries | as written |');
    lines.push('|---|---|---|');
    for (const row of metrics.absentTermCounts) {
      lines.push(`| ${row.term} | ${row.queries} | ${row.words.join(', ')} |`);
    }
  }

  lines.push('');
  lines.push('## Per query');
  lines.push('');
  lines.push('| n | absent terms | query |');
  lines.push('|---|---|---|');
  for (const row of [...args.scored].sort(
    (a, b) => b.absentTerms.length - a.absentTerms.length,
  )) {
    lines.push(
      `| ${row.occurrences} | ${row.absentTerms.join(', ') || '—'} | ${row.query.replace(/\|/g, '\\|')} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}
