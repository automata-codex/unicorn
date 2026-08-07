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
 * **Why grouped by turn.** The first judgment a scorer makes is "should this
 * lookup have happened at all," which is unanswerable without the situation.
 * `task eval:query-vocab`'s report is a flat list of queries and carries no
 * turn context, which is exactly what made it unusable for this. Grouping
 * states the player input once per turn instead of repeating it beside every
 * query.
 *
 * **What this deliberately does not ask.** Whether the query retrieved the
 * right thing. That is the tier-2 probe's job
 * (`scripts/retrieval-probe.core.ts`), and keeping it out is what makes this
 * scoring index-independent — so it can be done while the index is still
 * unfrozen, in parallel with the fixup decisions, per
 * `docs/plans/013-m7.5-open-work.md § Trap 3`.
 */

/** One scorable row: a distinct query as issued within one turn. */
export interface WorksheetRow {
  /**
   * Stable identifier, e.g. `turn19-system-rolled-player-action/03`.
   *
   * Present so filled-in labels can be joined back to their query even if
   * rows are later reordered or the query text is edited. Task 8 turns this
   * worksheet into a judge validation set, and a join key that is "the row's
   * position in a markdown table" would not survive that.
   */
  rowId: string;
  fixtureId: string;
  query: string;
  /** How many reps of this turn issued this exact query. */
  occurrences: number;
  /** Corpus-absent lexemes, as a hint. Not the answer to either judgment. */
  absentTerms: string[];
}

export interface WorksheetTurn {
  fixtureId: string;
  /** Absent when no fixture file matched — see `buildWorksheet`. */
  tag?: string;
  playerInput?: string;
  rows: WorksheetRow[];
}

/**
 * Group harvested queries by turn and attach fixture context.
 *
 * `harvested` comes from `harvestQueries`, whose `fixtureId` is the run
 * directory name; `fixtures` are keyed by `EvalFixture.id`. Those are the
 * same string — `eval:run` names each artifact directory after the fixture
 * id — which is the only reason this join is a lookup rather than a guess.
 *
 * A turn whose fixture file is missing is **kept, with no context**, rather
 * than dropped. The queries were really emitted; losing them because the
 * corpus moved on would quietly shrink the denominator, and a scorer can
 * still judge a query they have to reconstruct the situation for. The
 * renderer says so explicitly rather than leaving a blank.
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
  for (const item of args.harvested) {
    const perTurn = counts.get(item.fixtureId) ?? new Map<string, number>();
    perTurn.set(item.query, (perTurn.get(item.query) ?? 0) + 1);
    counts.set(item.fixtureId, perTurn);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fixtureId, perTurn]) => {
      const fixture = fixtureById.get(fixtureId);
      // Most-issued first: a phrasing the model reached for on every rep is
      // more informative about its habits than a one-off.
      const ordered = [...perTurn.entries()].sort(
        ([qa, na], [qb, nb]) => nb - na || qa.localeCompare(qb),
      );
      return {
        fixtureId,
        ...(fixture === undefined
          ? {}
          : { tag: fixture.tag, playerInput: fixture.playerInput.content }),
        rows: ordered.map(([query, occurrences], index) => ({
          rowId: `${fixtureId}/${String(index + 1).padStart(2, '0')}`,
          fixtureId,
          query,
          occurrences,
          absentTerms: absentByQuery.get(query) ?? [],
        })),
      };
    });
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
    'Two judgments per query, given the turn it was made in. **Do not judge whether it',
  );
  lines.push(
    "retrieved the right thing** — that is the tier-2 probe's job, and keeping it out is",
  );
  lines.push('what makes this scoring index-independent.');
  lines.push('');
  lines.push(
    '- **W — warranted?** Should this lookup have happened at all? A query about a mechanic',
  );
  lines.push(
    '  Mothership does not have is a *behavioural* failure, not a retrieval one: the right',
  );
  lines.push('  move was to adjudicate, not search.');
  lines.push(
    '- **E — expresses the need?** Does the query say what the Warden actually needed to know',
  );
  lines.push('  for this situation?');
  lines.push('');
  lines.push('Score `y` / `n` / `?` in the last two columns.');
  lines.push('');
  lines.push(
    '**The `absent` column is a hint, not an answer.** It lists corpus-absent lexemes. A query',
  );
  lines.push(
    'can carry an absent term and still be warranted and well phrased — `§ S5.3` measured',
  );
  lines.push(
    'embeddings bridging the vocabulary gap partially. More importantly the converse holds, and',
  );
  lines.push(
    'it is why this worksheet exists: every word of *"cover bonus to attack rolls in combat"* is',
  );
  lines.push(
    'in the corpus, so it scores clean, while naming a mechanic Mothership does not have',
  );
  lines.push('(cover grants Advantage `[+]`, never a numeric bonus).');
  lines.push('');
  lines.push(
    '**Write the rubric down as you go.** It becomes the validation set for a judge (Task 8),',
  );
  lines.push(
    'and it has to exist before the after-set does — otherwise it is authored knowing which',
  );
  lines.push('side is which.');
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
        'were still emitted and are kept rather than dropped. Reconstruct from the run artifacts',
      );
      lines.push('if you need to score them.');
    } else {
      lines.push(`**Tag:** \`${turn.tag}\``);
      lines.push('');
      lines.push(`**Player input:** ${turn.playerInput}`);
    }
    lines.push('');
    lines.push('| row | n | query | absent | W | E |');
    lines.push('|---|---|---|---|---|---|');
    for (const row of turn.rows) {
      lines.push(
        `| ${row.rowId.split('/')[1]} | ${row.occurrences} | ${escapeCell(row.query)} | ${
          row.absentTerms.join(', ') || '—'
        } |  |  |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
