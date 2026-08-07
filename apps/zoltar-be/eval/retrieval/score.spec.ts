import { describe, expect, it } from 'vitest';

import {
  computeMetrics,
  parseCitedPages,
  type RetrievalHit,
  scoreFixture,
} from './score';

import type { RetrievalFixture } from './fixture.schema';

function fixture(overrides: Partial<RetrievalFixture> = {}): RetrievalFixture {
  return {
    id: 'rq-001',
    system: 'mothership',
    query: 'what happens when a character panics',
    queryStyle: 'authored',
    expectedPages: [21],
    answerable: true,
    ...overrides,
  } as RetrievalFixture;
}

function hits(...sources: Array<[string, number]>): RetrievalHit[] {
  return sources.map(([source, similarity]) => ({ source, similarity }));
}

const LABEL = "Mothership Player's Survival Guide";

describe('parseCitedPages', () => {
  it('reads a single-page citation', () => {
    expect(parseCitedPages(`${LABEL} p.21`)).toEqual([21]);
  });

  it('expands a page range so either page matches', () => {
    // A chunk spanning a spread must satisfy a fixture labeled with either
    // page, or every multi-page chunk would score as a miss.
    expect(parseCitedPages(`${LABEL} pp.30-31`)).toEqual([30, 31]);
  });

  it('reads a citation with no page at all as no pages', () => {
    // The footer-less pages produce a label-only source. It cannot match a
    // page label, and must not throw or guess.
    expect(parseCitedPages(LABEL)).toEqual([]);
  });

  it('tolerates a reversed range rather than looping forever', () => {
    expect(parseCitedPages(`${LABEL} pp.31-30`)).toEqual([31]);
  });
});

describe('scoreFixture', () => {
  it('finds the rank of the first chunk citing an expected page', () => {
    const scored = scoreFixture(
      fixture(),
      hits(
        [`${LABEL} p.37`, 0.4],
        [`${LABEL} p.21`, 0.36],
        [`${LABEL} p.9`, 0.3],
      ),
    );

    expect(scored.hitRank).toBe(2);
    expect(scored.topSimilarity).toBe(0.4);
  });

  it('reports a miss as null rather than a large rank', () => {
    const scored = scoreFixture(fixture(), hits([`${LABEL} p.37`, 0.4]));

    expect(scored.hitRank).toBeNull();
  });

  it('counts a hit when any expected page comes back, not all of them', () => {
    const scored = scoreFixture(
      fixture({ expectedPages: [30, 31] }),
      hits([`${LABEL} p.31`, 0.4]),
    );

    expect(scored.hitRank).toBe(1);
  });

  it('matches a fixture page against a chunk that spans a range', () => {
    const scored = scoreFixture(
      fixture({ expectedPages: [31] }),
      hits([`${LABEL} pp.30-31`, 0.4]),
    );

    expect(scored.hitRank).toBe(1);
  });

  it('never assigns a rank to an unanswerable fixture', () => {
    const scored = scoreFixture(
      fixture({ answerable: false, expectedPages: [] }),
      hits([`${LABEL} p.27`, 0.22]),
    );

    expect(scored.hitRank).toBeNull();
    expect(scored.topSimilarity).toBe(0.22);
  });

  it('records a null top similarity when nothing came back', () => {
    const scored = scoreFixture(fixture(), []);

    expect(scored.topSimilarity).toBeNull();
    expect(scored.hitRank).toBeNull();
  });
});

describe('computeMetrics', () => {
  const at = (rank: number | null, answerable = true) =>
    scoreFixture(
      fixture({ answerable, expectedPages: answerable ? [21] : [] }),
      rank === null
        ? hits([`${LABEL} p.99`, 0.3])
        : hits(
            ...Array.from({ length: rank }, (_, i) =>
              i === rank - 1
                ? ([`${LABEL} p.21`, 0.5 - i * 0.01] as [string, number])
                : ([`${LABEL} p.99`, 0.5 - i * 0.01] as [string, number]),
            ),
          ),
    );

  it('scores recall@3 and recall@5 at their boundaries', () => {
    const metrics = computeMetrics([at(3), at(5), at(null)]);

    // rank 3 counts for @3; rank 5 does not, but counts for @5.
    expect(metrics.recallAt3).toBeCloseTo(1 / 3);
    expect(metrics.recallAt5).toBeCloseTo(2 / 3);
  });

  it('computes MRR as the mean reciprocal rank, scoring a miss as zero', () => {
    const metrics = computeMetrics([at(1), at(2), at(null)]);

    expect(metrics.mrr).toBeCloseTo((1 + 0.5 + 0) / 3);
  });

  it('excludes unanswerable fixtures from the recall denominator', () => {
    // The applicability discipline: a rate is reported with the denominator
    // it was computed over, and unanswerable fixtures are not in it.
    const metrics = computeMetrics([at(1), at(null, false), at(null, false)]);

    expect(metrics.answerable).toBe(1);
    expect(metrics.unanswerable).toBe(2);
    expect(metrics.recallAt3).toBe(1);
    expect(metrics.applicability).toBeCloseTo(1 / 3);
  });

  it('reports null rather than zero when nothing is answerable', () => {
    // An undefined rate is a real state and must not render as a bad score.
    const metrics = computeMetrics([at(null, false)]);

    expect(metrics.recallAt3).toBeNull();
    expect(metrics.mrr).toBeNull();
  });

  it('handles an empty fixture set without dividing by zero', () => {
    const metrics = computeMetrics([]);

    expect(metrics.applicability).toBeNull();
    expect(metrics.recallAt3).toBeNull();
    expect(metrics.answerableCorrectSimilarity.n).toBe(0);
  });

  it('splits the similarity distributions by answerability', () => {
    // The gap between these two is the raw material for the floor decision,
    // so a correct hit and an unanswerable query must never share a bucket.
    const metrics = computeMetrics([at(1), at(null), at(null, false)]);

    expect(metrics.answerableCorrectSimilarity.n).toBe(1);
    expect(metrics.unanswerableSimilarity.n).toBe(1);
  });

  it('takes the median of an even-sized distribution as the midpoint', () => {
    const rows = [
      scoreFixture(
        fixture({ answerable: false, expectedPages: [] }),
        hits([`${LABEL} p.1`, 0.2]),
      ),
      scoreFixture(
        fixture({ answerable: false, expectedPages: [] }),
        hits([`${LABEL} p.1`, 0.4]),
      ),
    ];

    expect(computeMetrics(rows).unanswerableSimilarity.median).toBeCloseTo(0.3);
  });
});
