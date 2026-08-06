import { computeMetrics, groupBy } from './score';

import type {
  RetrievalMetrics,
  ScoredFixture,
  SimilarityDistribution,
} from './score';

export interface IndexProvenance {
  system?: string;
  ingestedAt?: string;
  markerVersion?: string | null;
  embedModel?: string;
  embeddingDim?: number;
  chunkCount?: number;
  targetTokens?: number;
  overlapTokens?: number[];
  droppedPages?: number[];
  pdfSha256?: string;
}

export interface RunConfig {
  system: string;
  fixturePath: string;
  fixtureCount: number;
  limit: number;
  preprocess: boolean;
  dfThreshold?: number;
  startedAt: string;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null, digits = 3): string {
  return value === null ? '—' : value.toFixed(digits);
}

function distributionCells(d: SimilarityDistribution): string {
  if (d.n === 0) return '0 | — | — | —';
  return `${d.n} | ${num(d.min)} | ${num(d.median)} | ${num(d.max)}`;
}

function metricsRow(label: string, m: RetrievalMetrics): string {
  return `| ${label} | ${pct(m.recallAt3)} | ${pct(m.recallAt5)} | ${num(m.mrr)} | ${m.answerable} | ${m.unanswerable} |`;
}

export function renderRetrievalReport(args: {
  config: RunConfig;
  provenance: IndexProvenance | null;
  scored: ScoredFixture[];
}): string {
  const { config, provenance, scored } = args;
  const overall = computeMetrics(scored);
  const lines: string[] = [];

  lines.push(`# Retrieval eval — ${config.system}`);
  lines.push('');
  lines.push(`- Run: ${config.startedAt}`);
  lines.push(`- Fixtures: ${config.fixtureCount} (${config.fixturePath})`);
  lines.push(`- Lookup limit: ${config.limit}`);
  lines.push(
    `- Query preprocessing: ${
      config.preprocess
        ? `on${config.dfThreshold === undefined ? ' (default threshold)' : ` (threshold ${config.dfThreshold})`}`
        : '**off** (`--no-preprocess`)'
    }`,
  );

  // A retrieval score is only comparable against the same index build. This
  // is the analogue of corpusVersion/harnessVersion on the Warden side, and
  // omitting it reproduces exactly the cross-run confusion those exist to
  // prevent — so an absent manifest is stated, never quietly skipped.
  lines.push('');
  lines.push('## Index provenance');
  lines.push('');
  if (provenance === null) {
    lines.push(
      '**Unknown** — no `ingestion/.ingest-manifest.json` was found. These',
      'scores cannot be compared against another run without knowing which',
      'index build produced them. Re-run `task ingest` to record provenance.',
    );
  } else {
    lines.push(`- Chunks: ${provenance.chunkCount ?? '—'}`);
    lines.push(`- Ingested: ${provenance.ingestedAt ?? '—'}`);
    lines.push(`- marker: ${provenance.markerVersion ?? '—'}`);
    lines.push(
      `- Embed model: ${provenance.embedModel ?? '—'} (dim ${provenance.embeddingDim ?? '—'})`,
    );
    lines.push(
      `- Chunking: target ${provenance.targetTokens ?? '—'} tokens, overlap ${
        provenance.overlapTokens?.join('–') ?? '—'
      }, dropped pages ${
        provenance.droppedPages?.length
          ? provenance.droppedPages.join(', ')
          : 'none'
      }`,
    );
  }

  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push(
    '| Group | recall@3 | recall@5 | MRR | answerable (n) | unanswerable (excluded) |',
  );
  lines.push('|---|---|---|---|---|---|');
  lines.push(metricsRow('all', overall));

  const byStyle = groupBy(scored, (row) => row.queryStyle);
  for (const style of [...byStyle.keys()].sort()) {
    lines.push(
      metricsRow(`style: ${style}`, computeMetrics(byStyle.get(style) ?? [])),
    );
  }

  const byTag = groupBy(scored, (row) => row.sourceTag);
  if (byTag.size > 0) {
    lines.push('');
    lines.push('## By source tag');
    lines.push('');
    lines.push(
      'A chunking change that helps combat queries and hurts investigation',
    );
    lines.push('queries is visible here rather than averaged away.');
    lines.push('');
    lines.push(
      '| Group | recall@3 | recall@5 | MRR | answerable (n) | unanswerable (excluded) |',
    );
    lines.push('|---|---|---|---|---|---|');
    for (const tag of [...byTag.keys()].sort()) {
      lines.push(metricsRow(tag, computeMetrics(byTag.get(tag) ?? [])));
    }
  }

  lines.push('');
  lines.push('## Similarity distributions');
  lines.push('');
  lines.push(
    'The gap between these two rows *is* the similarity floor. If they',
  );
  lines.push(
    'overlap, no threshold separates them and the honest conclusion is',
  );
  lines.push(
    'that retrieval has to improve before a floor is worth adding. This',
  );
  lines.push('harness produces the numbers; deriving the floor is M7.5.');
  lines.push('');
  lines.push('| Set | n | min | median | max |');
  lines.push('|---|---|---|---|---|');
  lines.push(
    `| answerable, correct hit | ${distributionCells(overall.answerableCorrectSimilarity)} |`,
  );
  lines.push(
    `| unanswerable | ${distributionCells(overall.unanswerableSimilarity)} |`,
  );

  lines.push('');
  lines.push('## Per fixture');
  lines.push('');
  lines.push(
    '| id | style | answerable | expected | returned | rank | top sim |',
  );
  lines.push('|---|---|---|---|---|---|---|');
  for (const row of scored) {
    const returned = row.returnedPages
      .map((pages) => (pages.length === 0 ? '?' : pages.join('/')))
      .join(', ');
    lines.push(
      `| ${row.id} | ${row.queryStyle} | ${row.answerable ? 'yes' : 'no'} | ${
        row.expectedPages.join(', ') || '—'
      } | ${returned || '—'} | ${row.hitRank ?? (row.answerable ? 'miss' : '—')} | ${num(row.topSimilarity)} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}
