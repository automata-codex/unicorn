import { describe, expect, it } from 'vitest';

import {
  ANSWERABLE_CORRECT_MIN,
  bucketTopSimilarity,
  computeProbeMetrics,
  probeQueries,
  renderRetrievalProbeReport,
  UNANSWERABLE_MAX,
} from './retrieval-probe.core';

import type {
  HarvestedProbeQuery,
  ProbeChunk,
  ProbedQuery,
  ProbeLookup,
} from './retrieval-probe.core';

/**
 * A stand-in for `RulesLookupService.lookup()` over a table of canned
 * similarities, injected exactly as `query-vocab.core.spec.ts` injects a fake
 * `TermLookup`.
 *
 * What this file tests is everything built on top of retrieval — the § S20
 * bucketing, the distinct-vs-weighted denominators, the per-model split, and
 * the report text. The Voyage call and the pgvector SQL are deliberately not
 * exercised here: they are the service's own tests' job, and mocking them
 * would only assert that the mock was called.
 */
function fakeLookup(table: Record<string, ProbeChunk[]>): ProbeLookup {
  return (query) => Promise.resolve({ results: table[query] ?? [] });
}

function chunk(similarity: number, source = 'PSG p.7'): ProbeChunk {
  return { source, similarity };
}

function harvest(
  ...calls: Array<[query: string, model: string]>
): HarvestedProbeQuery[] {
  return calls.map(([query, model], index) => ({
    query,
    model,
    fixtureId: `turn0${index}`,
    rep: '001',
  }));
}

describe('bucketTopSimilarity', () => {
  it('puts a similarity above every unanswerable fixture in `above`', () => {
    expect(bucketTopSimilarity(0.52)).toBe('above');
  });

  it('puts a similarity below every correct hit in `below`', () => {
    expect(bucketTopSimilarity(0.29)).toBe('below');
  });

  it('puts a similarity inside the § S20.1 overlap in `overlap`', () => {
    expect(bucketTopSimilarity(0.38)).toBe('overlap');
  });

  it('treats both § S20.1 endpoints as inside the overlap', () => {
    // The endpoints are observed values, not gaps. 0.416 is the top-1
    // similarity of two real unanswerable fixtures, so a query sitting on it
    // is not above *every* unanswerable one; 0.342 is a real correct hit, so
    // a query sitting on it is not below *every* correct one. Making either
    // boundary exclusive would claim a separation the measurement does not
    // support.
    expect(bucketTopSimilarity(UNANSWERABLE_MAX)).toBe('overlap');
    expect(bucketTopSimilarity(ANSWERABLE_CORRECT_MIN)).toBe('overlap');
  });

  it('keeps "returned nothing" distinct from "returned something weak"', () => {
    // Collapsing `none` into `below` would make an unpopulated index look
    // like bad retrieval, which is the failure mode the runner's empty-index
    // guard exists to prevent and this keeps visible if one ever slips past.
    expect(bucketTopSimilarity(null)).toBe('none');
    expect(bucketTopSimilarity(0)).toBe('below');
  });
});

describe('probeQueries', () => {
  it('probes each distinct query once and keeps its occurrence count', async () => {
    // One Voyage call per distinct query is the whole cost model: the same
    // text embeds to the same vector every time, so probing a repeat spends
    // real money to re-derive a value already in hand.
    const seen: string[] = [];
    const lookup: ProbeLookup = (query) => {
      seen.push(query);
      return Promise.resolve({ results: [chunk(0.5)] });
    };

    const { probed, metrics } = await probeQueries(
      harvest(
        ['panic check', 'claude-sonnet-5'],
        ['panic check', 'claude-sonnet-5'],
        ['armor points', 'claude-sonnet-5'],
      ),
      lookup,
    );

    expect(seen).toEqual(['armor points', 'panic check']);
    expect(probed).toHaveLength(2);
    expect(metrics.overall.distinctQueries).toBe(2);
    expect(metrics.overall.totalLookups).toBe(3);
  });

  it('buckets by top-1 similarity, ignoring the weaker chunks below it', async () => {
    const { probed } = await probeQueries(
      harvest(['wound table', 'claude-sonnet-5']),
      fakeLookup({ 'wound table': [chunk(0.51), chunk(0.33), chunk(0.31)] }),
    );

    expect(probed[0].topSimilarity).toBeCloseTo(0.51);
    expect(probed[0].bucket).toBe('above');
    expect(probed[0].similarities).toHaveLength(3);
  });

  it('records the returned sources so a row can be read without the chunk text', async () => {
    const { probed } = await probeQueries(
      harvest(['armor points', 'claude-sonnet-5']),
      fakeLookup({
        'armor points': [chunk(0.44, 'PSG p.2'), chunk(0.4, 'PSG pp.14-15')],
      }),
    );

    expect(probed[0].sources).toEqual(['PSG p.2', 'PSG pp.14-15']);
  });

  it('buckets a query that returned nothing as `none`, not as a low score', async () => {
    const { probed, metrics } = await probeQueries(
      harvest(['flanking bonus', 'claude-sonnet-5']),
      fakeLookup({}),
    );

    expect(probed[0].topSimilarity).toBeNull();
    expect(probed[0].bucket).toBe('none');
    expect(metrics.overall.buckets.none).toBe(1);
    expect(metrics.overall.buckets.below).toBe(0);
  });

  it('counts a query emitted by both models under both', async () => {
    // The model rows are views on one probed set, not a partition of it —
    // partitioning would make a query issued by both models arbitrarily
    // belong to whichever run happened to be passed first.
    const { metrics } = await probeQueries(
      harvest(
        ['panic check', 'claude-sonnet-4-6'],
        ['panic check', 'claude-sonnet-5'],
        ['stress save', 'claude-sonnet-5'],
      ),
      fakeLookup({ 'panic check': [chunk(0.5)], 'stress save': [chunk(0.3)] }),
    );

    const [fourSix, five] = metrics.byModel;
    expect(fourSix.label).toBe('claude-sonnet-4-6');
    expect(fourSix.distinctQueries).toBe(1);
    expect(fourSix.buckets.above).toBe(1);
    expect(five.distinctQueries).toBe(2);
    expect(five.buckets.above).toBe(1);
    expect(five.buckets.below).toBe(1);
  });

  it('weights buckets by how often each query was actually issued', async () => {
    const { metrics } = await probeQueries(
      harvest(
        ['panic check', 'claude-sonnet-5'],
        ['panic check', 'claude-sonnet-5'],
        ['panic check', 'claude-sonnet-5'],
        ['flanking bonus', 'claude-sonnet-5'],
      ),
      fakeLookup({
        'panic check': [chunk(0.5)],
        'flanking bonus': [chunk(0.3)],
      }),
    );

    expect(metrics.overall.buckets).toMatchObject({ above: 1, below: 1 });
    expect(metrics.overall.weightedBuckets).toMatchObject({
      above: 3,
      below: 1,
    });
  });

  it('takes the same subset every time under --limit-queries, and says how many it skipped', async () => {
    // A smoke test that probed a different subset each run would prove
    // nothing about the wiring it exists to prove, and `distinctHarvested`
    // is what stops a partial run being read as a full one.
    const { probed, distinctHarvested } = await probeQueries(
      harvest(
        ['charlie', 'claude-sonnet-5'],
        ['alpha', 'claude-sonnet-5'],
        ['bravo', 'claude-sonnet-5'],
      ),
      fakeLookup({}),
      { limitQueries: 2 },
    );

    expect(probed.map((row) => row.query)).toEqual(['alpha', 'bravo']);
    expect(distinctHarvested).toBe(3);
  });

  it('reports the top-1 distribution across probed queries', async () => {
    const { metrics } = await probeQueries(
      harvest(
        ['a', 'claude-sonnet-5'],
        ['b', 'claude-sonnet-5'],
        ['c', 'claude-sonnet-5'],
      ),
      fakeLookup({ a: [chunk(0.3)], b: [chunk(0.5)], c: [chunk(0.4)] }),
    );

    expect(metrics.topSimilarity).toMatchObject({ n: 3 });
    expect(metrics.topSimilarity?.min).toBeCloseTo(0.3);
    expect(metrics.topSimilarity?.median).toBeCloseTo(0.4);
    expect(metrics.topSimilarity?.max).toBeCloseTo(0.5);
  });
});

describe('computeProbeMetrics', () => {
  it('reports a null distribution rather than zeros for an empty set', () => {
    // Same "undefined is not zero" discipline the retrieval scorer applies to
    // recall: a min/median/max of 0.000 would read as catastrophically bad
    // retrieval on a run that probed nothing at all.
    const metrics = computeProbeMetrics([]);

    expect(metrics.topSimilarity).toBeNull();
    expect(metrics.overall.distinctQueries).toBe(0);
    expect(metrics.byModel).toEqual([]);
  });
});

describe('renderRetrievalProbeReport', () => {
  const probed: ProbedQuery[] = [
    {
      query: 'panic check stress',
      occurrences: 2,
      occurrencesByModel: [{ model: 'claude-sonnet-5', occurrences: 2 }],
      sources: ['PSG p.7'],
      similarities: [0.51],
      topSimilarity: 0.51,
      bucket: 'above',
    },
    {
      query: 'flanking bonus',
      occurrences: 1,
      occurrencesByModel: [{ model: 'claude-sonnet-5', occurrences: 1 }],
      sources: ['PSG p.9'],
      similarities: [0.3],
      topSimilarity: 0.3,
      bucket: 'below',
    },
  ];

  function render(
    overrides: Partial<Parameters<typeof renderRetrievalProbeReport>[0]> = {},
  ) {
    return renderRetrievalProbeReport({
      runs: [{ runDir: '/runs/sonnet5', model: 'claude-sonnet-5' }],
      system: 'mothership',
      chunkCount: 61,
      lookupLimit: 3,
      startedAt: new Date('2026-08-07T12:00:00Z'),
      probed,
      metrics: computeProbeMetrics(probed),
      distinctHarvested: probed.length,
      provenance: null,
      ...overrides,
    });
  }

  it('carries the pairing rule in the header, not a claim about the index state', () => {
    // Trap 3. A bucket table is exactly the kind of output that gets pasted
    // into a findings session without its surroundings, so the caveat is in
    // the first block rather than a footnote.
    //
    // This asserts the *rule* and the presence of the index build, not any
    // particular sentence about the world. The first version of this test
    // pinned "the index is not frozen", which was true the day it was written
    // and false the next — leaving a correct report carrying a wrong warning
    // and a green test defending it.
    const report = render();

    expect(report).toMatch(/same\* index[\s\S]*for both readings/);
    expect(report).toContain('Index build:');
    expect(report).not.toMatch(/not frozen/);
  });

  it('states the limits of the bucketing next to the bucketing', () => {
    // Without this paragraph the table reads as a score, and a reader who
    // takes it that way has re-created the runtime floor § S20.2 measured
    // and declined to ship.
    const report = render();

    expect(report).toContain('47 labelled fixtures');
    expect(report).toContain('interleaved');
    expect(report).toMatch(/triage/i);
    expect(report).toMatch(/not a verdict/i);
  });

  it('marks a truncated run as partial and names both counts', () => {
    const report = render({ distinctHarvested: 102 });

    expect(report).toContain('Partial run');
    expect(report).toContain('probed 2 of the');
    expect(report).toContain('102 distinct queries harvested');
  });

  it('says nothing about being partial on a complete run', () => {
    expect(render()).not.toContain('Partial run');
  });

  it('lists the most-suspect rows first', () => {
    // The table is read top-down by a human deciding what to look at, so a
    // `below` row has to outrank an `above` one regardless of query text.
    const report = render();

    expect(report.indexOf('flanking bonus')).toBeLessThan(
      report.indexOf('panic check stress'),
    );
  });

  it('records that preprocessing was on, since that is what production does', () => {
    expect(render()).toMatch(/preprocessing \*\*on\*\*/);
  });

  it('says the index build is unknown rather than omitting it', () => {
    // The analogue of the retrieval report's provenance block: a probe whose
    // index build is unrecorded cannot be compared with another one, and
    // silently skipping the line reproduces exactly the cross-run confusion
    // Trap 3 is about.
    expect(render()).toContain('**unknown**');
  });
});
