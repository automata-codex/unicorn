import type { EvalFixture } from '../eval/fixture.schema';
import type { HarvestedQuery, ScoredQuery } from './query-vocab.core';

/**
 * Renders a hand-scoring worksheet for the `rules_lookup` queries a Warden
 * emitted, grouped by the turn that produced them.
 *
 * **Why this exists as a script rather than a one-off.** M7.5 open-work
 * Task 2 scores the *before* set; the identical worksheet is needed for the
 * *after* set once Part H runs, and the two are only comparable if they were
 * generated the same way. Regenerating by hand invites a subtly different
 * format — a reordered column, a differently-escaped pipe — that silently
 * breaks the pairing.
 *
 * **Why grouped by turn.** The first judgment a scorer makes depends on the
 * situation, which `task eval:query-vocab`'s flat query list does not carry.
 * Grouping states the player input once per turn instead of repeating it
 * beside every query.
 *
 * **What this deliberately does not ask.** Whether the query retrieved the
 * right thing — that is the tier-2 probe's job
 * (`scripts/retrieval-probe.core.ts`), and keeping it out is what makes this
 * scoring index-independent, so it can proceed while the index is unfrozen
 * (`docs/plans/013-m7.5-open-work.md § Trap 3`).
 *
 * ---
 *
 * **The circular criterion this file used to have, and why the columns are
 * shaped as they are now.** The first version asked a single question —
 * *"was this lookup warranted?"* — and defined an unwarranted lookup as one
 * asking about a mechanic Mothership does not have. That is circular: the
 * Warden cannot know the book lacks a cover bonus without looking it up, so
 * the criterion scored correct epistemic behaviour as failure.
 *
 * It also conflated two different things. In the corpus's worst turn the
 * Warden asked about cover ten times in ten rephrasings. Asking *once* was
 * right. Asking nine more times is the actual violation, and the Warden
 * prompt already forbids it ("Do not retry the same query hoping for
 * different results").
 *
 * So the question is split four ways, and only three go to a human:
 *
 * - **C** — is the mechanic in the book? A *factual label about the query*,
 *   not blame. It is excusable in the before-set precisely because the
 *   Warden could not have known, and inexcusable in the after-set, where the
 *   mechanical-model primer states it. That asymmetry is how the primer's
 *   effect becomes visible, and it is also why warrant cannot be a fixed
 *   property of a query.
 * - **N** — did the *situation* call for a lookup? Judged from the player
 *   input alone, so it needs no rules knowledge.
 * - **E** — does the query express what was needed?
 * - **R** — near-duplicate family, computed here rather than scored.
 */

/** One scorable row: a distinct query as issued within one turn. */
export interface WorksheetRow {
  /**
   * Stable identifier, e.g. `turn19-system-rolled-player-action/03`.
   *
   * Present so filled-in labels can be joined back even if rows are later
   * reordered or the query text is edited. Task 8 turns this worksheet into
   * a judge validation set, and a join key that is "the row's position in a
   * markdown table" would not survive that.
   */
  rowId: string;
  fixtureId: string;
  query: string;
  /** How many reps of this turn issued this exact query. */
  occurrences: number;
  /** Corpus-absent lexemes, as a hint. Not the answer to any judgment. */
  absentTerms: string[];
  /**
   * Label (`a`, `b`, …) shared by near-duplicate queries within this turn,
   * or absent when the query has no near-duplicate. See
   * :func:`clusterNearDuplicates`.
   */
  family?: string;
}

export interface WorksheetTurn {
  fixtureId: string;
  /** Absent when no fixture file matched — see `buildWorksheet`. */
  tag?: string;
  playerInput?: string;
  rows: WorksheetRow[];
  /**
   * The largest number of same-family queries issued within a **single rep**
   * of this turn.
   *
   * Distinct from the family sizes visible in the rows, and the distinction
   * matters. Rows are deduplicated across reps, so a family of six could mean
   * "one rep asked six ways" (a retry cascade) or "six reps each asked once,
   * differently" (ordinary sampling variation). Only this number
   * distinguishes them, and only the first is the behaviour the prompt
   * forbids.
   */
  maxSameFamilyInOneRep: number;
}

/**
 * Words dropped before comparing two queries for near-duplication.
 *
 * English function words, plus `mothership` — the system's own name appears
 * as a bare qualifier in a large share of queries and cannot discriminate
 * between two of them within a single-system corpus. Deliberately short: a
 * longer list starts encoding judgments about which *rules* vocabulary
 * matters, which is the scorer's job, not this function's.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'what',
  'when',
  'which',
  'with',
  'you',
  'your',
  'mothership',
]);

/**
 * Query text to a comparable token set.
 *
 * Crude plural stripping only, and deliberately not Postgres stemming: the
 * comparison is query-to-query, both sides get the same treatment, and
 * pulling the corpus stemmer in here would make a pure function need a
 * database.
 *
 * A trailing `s` is dropped unless preceded by `s`, `u`, or `i`. Those three
 * letters guard the singulars this vocabulary actually contains — `stress`,
 * `bonus`, `this` — and `bonus` is not hypothetical: it is among the most
 * frequent words in these queries, and stripping it to `bonu` would stop it
 * matching `bonuses`. Everything the clustering needs still collapses:
 * `rolls`, `saves`, `checks`, `modifiers`, `weapons`.
 */
export function normalizeTokens(query: string): Set<string> {
  const words = query.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? [];
  return new Set(
    words
      .map((word) => word.replace(/(?<![sui])s$/, ''))
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Threshold for "these two queries are the same question rephrased."
 *
 * 0.5 on normalized token sets. Calibrated against the corpus's worst turn:
 * *"using cover in combat, attack roll modifiers for cover"* and *"cover
 * bonus to armor or attack rolls in combat"* score exactly 0.5 and are
 * plainly the same question, while *"firearms combat attack roll damage
 * weapon rifle"* scores 0.3 against the same query and is plainly a
 * different one.
 *
 * The technique is the one `docs/rules-extraction-findings.md § S15.5`
 * proposed for the fixture sampler's near-duplicate problem — same corpus,
 * same failure, so the same normalisation applies.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.5;

/**
 * Group a turn's distinct queries into near-duplicate families.
 *
 * Greedy, comparing each query against a family's **first** member rather
 * than any member. Single-linkage would chain — A near B, B near C, A far
 * from C — and silently merge two genuinely different questions through an
 * intermediate phrasing. Comparing against a fixed representative keeps a
 * family meaning "these are all rephrasings of *this* question."
 *
 * Input order matters and is the caller's responsibility: it passes queries
 * most-issued first, so the representative is the phrasing the model reached
 * for most often.
 *
 * Returns query -> family label, with singletons omitted. A family of one is
 * not a finding.
 */
export function clusterNearDuplicates(queries: string[]): Map<string, string> {
  const families: Array<{ representative: Set<string>; members: string[] }> =
    [];

  for (const query of queries) {
    const tokens = normalizeTokens(query);
    const existing = families.find(
      (family) =>
        jaccard(family.representative, tokens) >= NEAR_DUPLICATE_THRESHOLD,
    );
    if (existing) existing.members.push(query);
    else families.push({ representative: tokens, members: [query] });
  }

  const labels = new Map<string, string>();
  let next = 0;
  for (const family of families) {
    if (family.members.length < 2) continue;
    const label = String.fromCharCode(97 + (next % 26));
    next += 1;
    for (const member of family.members) labels.set(member, label);
  }
  return labels;
}

/**
 * Largest run of same-family queries inside one rep of one turn.
 *
 * Counts per (rep, family) and takes the maximum, which answers "did a single
 * pass at this turn rephrase the same question repeatedly" — the behaviour
 * the prompt forbids — rather than "do the reps collectively show many
 * phrasings," which is just sampling.
 */
function maxSameFamilyInOneRep(
  harvested: HarvestedQuery[],
  families: Map<string, string>,
): number {
  const perRepFamily = new Map<string, number>();
  for (const item of harvested) {
    const family = families.get(item.query);
    if (family === undefined) continue;
    const key = `${item.rep} ${family}`;
    perRepFamily.set(key, (perRepFamily.get(key) ?? 0) + 1);
  }
  return perRepFamily.size === 0 ? 0 : Math.max(...perRepFamily.values());
}

/**
 * Group harvested queries by turn and attach fixture context.
 *
 * `harvested`'s `fixtureId` is the run directory name and `fixtures` are keyed
 * by `EvalFixture.id`. Those are the same string — `eval:run` names each
 * artifact directory after the fixture id — which is the only reason this
 * join is a lookup rather than a guess.
 *
 * A turn whose fixture file is missing is **kept, with no context**, rather
 * than dropped. The queries were really emitted; losing them because the
 * corpus moved on would quietly shrink the denominator.
 */
export function buildWorksheet(args: {
  harvested: HarvestedQuery[];
  scored: ScoredQuery[];
  fixtures: EvalFixture[];
}): WorksheetTurn[] {
  const absentByQuery = new Map(
    args.scored.map((row) => [row.query, row.absentTerms]),
  );
  const fixtureById = new Map(args.fixtures.map((f) => [f.id, f]));

  const counts = new Map<string, Map<string, number>>();
  const byFixture = new Map<string, HarvestedQuery[]>();
  for (const item of args.harvested) {
    const perTurn = counts.get(item.fixtureId) ?? new Map<string, number>();
    perTurn.set(item.query, (perTurn.get(item.query) ?? 0) + 1);
    counts.set(item.fixtureId, perTurn);
    byFixture.set(item.fixtureId, [
      ...(byFixture.get(item.fixtureId) ?? []),
      item,
    ]);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fixtureId, perTurn]) => {
      const fixture = fixtureById.get(fixtureId);
      // Most-issued first: a phrasing the model reached for on every rep is
      // more informative than a one-off, and it makes that phrasing the
      // representative each near-duplicate family is measured against.
      const ordered = [...perTurn.entries()].sort(
        ([qa, na], [qb, nb]) => nb - na || qa.localeCompare(qb),
      );
      const families = clusterNearDuplicates(ordered.map(([query]) => query));

      return {
        fixtureId,
        ...(fixture === undefined
          ? {}
          : { tag: fixture.tag, playerInput: fixture.playerInput.content }),
        maxSameFamilyInOneRep: maxSameFamilyInOneRep(
          byFixture.get(fixtureId) ?? [],
          families,
        ),
        rows: ordered.map(([query, occurrences], index) => ({
          rowId: `${fixtureId}/${String(index + 1).padStart(2, '0')}`,
          fixtureId,
          query,
          occurrences,
          absentTerms: absentByQuery.get(query) ?? [],
          ...(families.has(query) ? { family: families.get(query) } : {}),
        })),
      };
    });
}

/**
 * Whether writing to `path` would clobber something, and what to say if so.
 *
 * **This worksheet is the one artifact in the eval tooling that is *designed*
 * to be hand-edited.** Every other `--output` in `scripts/` writes a derived
 * report that can be regenerated at no cost, so overwriting one loses
 * nothing. Regenerating this one over a scored copy destroys an evening of
 * judgment that exists nowhere else — the labels are not derivable from
 * anything, which is the entire reason a human is producing them.
 *
 * It nearly happened: the before-set worksheet was regenerated three times in
 * one session while scoring was in progress, and only survived because the
 * scoring started after the last regeneration. A guard that depends on
 * whoever runs the command remembering the hazard is not a guard.
 *
 * Pure so the policy is testable without touching a filesystem; the runner
 * supplies `exists`. Returns the message to print, or `null` to proceed.
 */
export function overwriteRefusal(args: {
  path: string;
  exists: boolean;
  force: boolean;
}): string | null {
  if (!args.exists || args.force) return null;
  return (
    `refusing to overwrite ${args.path}\n\n` +
    'This worksheet is meant to be filled in by hand, and regenerating it ' +
    'would discard any scoring already in the file. Labels are not derivable ' +
    'from anything else.\n\n' +
    'Write the new worksheet somewhere else with --output, or pass --force if ' +
    'you are certain the existing file holds nothing you want.\n'
  );
}

/** Markdown table cells are pipe-delimited, so a pipe in a query breaks the row. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

export function renderWorksheet(args: {
  turns: WorksheetTurn[];
  model: string;
  promptHash: string;
  runDir: string;
  generatedAt: string;
}): string {
  const { turns } = args;
  const rowCount = turns.reduce((sum, turn) => sum + turn.rows.length, 0);
  const lines: string[] = [];

  lines.push(
    `# \`rules_lookup\` query scoring — \`${args.model}\`, prompt \`${args.promptHash}\``,
  );
  lines.push('');
  lines.push(`- Run: ${args.runDir}`);
  lines.push(`- Generated: ${args.generatedAt}`);
  lines.push(
    `- **${rowCount} query rows across ${turns.length} turns.** A query repeated across reps is one row.`,
  );
  lines.push('');
  lines.push('## How to score');
  lines.push('');
  lines.push(
    'Three judgments per query. **Do not judge whether it retrieved the right thing** —',
  );
  lines.push(
    "that is the tier-2 probe's job, and keeping it out is what makes this scoring",
  );
  lines.push('index-independent.');
  lines.push('');
  lines.push('| Col | Question | `y` means |');
  lines.push('|---|---|---|');
  lines.push(
    '| **C** | Is this mechanic **in the book**? | Mothership has the thing being asked about |',
  );
  lines.push(
    '| **N** | Did the **situation** call for a lookup at all? | A rule genuinely bore on this turn |',
  );
  lines.push(
    '| **E** | Does the query **express what was needed**? | It asks for the thing the situation required |',
  );
  lines.push('');
  lines.push('Score `y` / `n` / `?`, and `—` where a column does not apply.');
  lines.push('');
  lines.push(
    '**`E` is undefined when `N=n`.** If the situation called for no lookup there was no',
  );
  lines.push(
    'need to express, so `E` gets `—`, not `?` and not `n`. Keep those apart: `?` means you',
  );
  lines.push(
    'looked and could not decide, which is a real state worth preserving; `—` means the',
  );
  lines.push(
    'question has no referent. Folding them together makes genuine uncertainty and',
  );
  lines.push(
    'structural non-applicability indistinguishable at analysis time — the same reason this',
  );
  lines.push(
    'repo keeps `NOT_APPLICABLE` out of its pass/fail denominators and treats `error` as a',
  );
  lines.push('fourth verdict rather than a failure.');
  lines.push('');
  lines.push(
    '`C` is independent of both. A query can ask clearly (`E=y`) for a mechanic that does',
  );
  lines.push(
    'not exist (`C=n`), and a mechanic is in the book or not regardless of whether this turn',
  );
  lines.push('needed it.');
  lines.push('');
  lines.push(
    '**Report every rate with its denominator.** `E` is a rate over `N=y` rows only, and the',
  );
  lines.push(
    'row counts themselves move between before and after — the Warden emits a different',
  );
  lines.push(
    'number of queries under a different prompt. A rate that improved because its hard cases',
  );
  lines.push(
    "dropped out of the denominator is the failure `eval:compare`'s App/ΔApp columns exist",
  );
  lines.push('to make visible; it applies here too.');
  lines.push('');
  lines.push(
    '**C is a factual label, not blame.** The Warden cannot know the book lacks a cover',
  );
  lines.push(
    'bonus without looking, so `C=n` is *excusable* here — and not excusable in the',
  );
  lines.push(
    'after-set, where the mechanical-model primer states it outright. That asymmetry is how',
  );
  lines.push(
    'the primer\'s effect becomes visible, and it is why there is no single "was this',
  );
  lines.push(
    'warranted" column: warrant depends on what the Warden had been told, so it is not a',
  );
  lines.push('fixed property of a query.');
  lines.push('');
  lines.push(
    '**N needs no rules knowledge.** Judge it from the player input alone — it catches a',
  );
  lines.push('lookup on a turn where the Warden should simply have narrated.');
  lines.push('');
  lines.push('## Two hint columns you do not score');
  lines.push('');
  lines.push(
    '**`absent`** lists corpus-absent lexemes. A hint, not an answer, in both directions:',
  );
  lines.push(
    'a query can carry an absent term and still be fine (`§ S5.3` — embeddings bridge the',
  );
  lines.push(
    'vocabulary gap partially), and more importantly the converse holds. Every word of',
  );
  lines.push(
    '*"cover bonus to attack rolls in combat"* is in the corpus, so it reads clean, while',
  );
  lines.push(
    'naming a mechanic Mothership does not have — cover grants Advantage `[+]`, never a',
  );
  lines.push('numeric bonus. That is a `C=n` the `absent` column cannot see.');
  lines.push('');
  lines.push(
    '**`R`** groups near-duplicate queries within a turn into families (`a`, `b`, …), by',
  );
  lines.push(
    'normalised token overlap. Rows sharing a letter are the same question rephrased.',
  );
  lines.push(
    'Also a hint: a rephrasing that meaningfully *narrows* the question can be legitimate,',
  );
  lines.push('and only you can tell that from a retry.');
  lines.push('');
  lines.push(
    'Each turn notes **`max same-family in one rep`**. That is the number that matters for',
  );
  lines.push(
    'retry behaviour: rows are deduplicated across reps, so a family of six could be one',
  );
  lines.push(
    'rep asking six ways (the cascade the prompt forbids) or six reps each asking once',
  );
  lines.push('(ordinary sampling). Only this figure separates them.');
  lines.push('');
  lines.push('## The rubric');
  lines.push('');
  lines.push(
    '**Write one rubric per column, for the whole set — not per row.** The model is',
  );
  lines.push(
    '`eval/checks/judged/rubrics.ts`, which holds one rubric per tag: a question, what',
  );
  lines.push(
    'passes, what violates, and the concrete examples that fix the borderline.',
  );
  lines.push('');
  lines.push(
    'Write it *as you go*, because the borderlines are what you cannot anticipate — does',
  );
  lines.push(
    '`turn order` count as the book having `initiative`? The first rows will force rulings',
  );
  lines.push(
    "you did not expect, and those rulings **are** the rubric. It then becomes Task 8's",
  );
  lines.push(
    'validation set: a judge gets the rubric, and its agreement with your labels is what',
  );
  lines.push('says whether automating this is safe.');
  lines.push('');
  lines.push(
    '`row` is a stable join key. Keep it if you move rows around; labels are matched on it.',
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const turn of turns) {
    lines.push(`## \`${turn.fixtureId}\``);
    lines.push('');
    if (turn.playerInput === undefined) {
      lines.push(
        '**No fixture file matched this turn**, so the situation is unavailable — the queries',
      );
      lines.push(
        'were still emitted and are kept rather than dropped. Reconstruct from the run',
      );
      lines.push('artifacts if you need to score them.');
    } else {
      lines.push(`**Tag:** \`${turn.tag}\``);
      lines.push('');
      lines.push(`**Player input:** ${turn.playerInput}`);
    }
    lines.push('');
    lines.push(
      `**Max same-family queries in one rep:** ${turn.maxSameFamilyInOneRep}` +
        (turn.maxSameFamilyInOneRep >= 3
          ? ' — a retry cascade within a single pass'
          : ''),
    );
    lines.push('');
    lines.push('| row | n | R | query | absent | C | N | E |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const row of turn.rows) {
      lines.push(
        `| ${row.rowId.split('/')[1]} | ${row.occurrences} | ${row.family ?? '—'} | ${escapeCell(
          row.query,
        )} | ${row.absentTerms.join(', ') || '—'} |  |  |  |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
