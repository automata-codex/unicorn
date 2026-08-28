import { describe, expect, it } from 'vitest';

import {
  checkBaselineDisposition,
  findStandingPoint,
  timestampOf,
} from './baseline.core';

const STANDING = 'claude-sonnet-5__fa4e6e2f__2026-08-21T11-05-26Z';
const NEWER = 'claude-sonnet-5__e83e8aaa__2026-08-24T11-21-49Z';
const OLDER = 'claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z';

function methodology(body = ''): string {
  return `## Current baseline N\n\n- **Last recorded:** \`${STANDING}\`.\n\n${body}`;
}

describe('timestampOf', () => {
  it('reads the trailing timestamp off a run id', () => {
    expect(timestampOf(STANDING)).toBe('2026-08-21T11-05-26Z');
  });

  it('sorts lexicographically in chronological order', () => {
    // The whole check rests on this, which is why the timestamps keep their
    // dash-separated form rather than being parsed into dates.
    expect(timestampOf(OLDER)! < timestampOf(STANDING)!).toBe(true);
    expect(timestampOf(STANDING)! < timestampOf(NEWER)!).toBe(true);
  });

  it('returns null for something that is not a run id', () => {
    expect(timestampOf('eval-log.md')).toBe(null);
  });
});

describe('findStandingPoint', () => {
  it('reads the run id off the marker line', () => {
    expect(findStandingPoint(methodology())).toBe(STANDING);
  });

  it('is null when the marker is missing', () => {
    expect(findStandingPoint('## Current baseline N\n\nN = 10.')).toBe(null);
  });

  it('takes the first run id after the marker, not the first in the file', () => {
    const text = `Earlier prose naming \`${OLDER}\`.\n\n${methodology()}`;
    expect(findStandingPoint(text)).toBe(STANDING);
  });
});

describe('checkBaselineDisposition', () => {
  it('passes when a newer run is named anywhere in the file', () => {
    // Anywhere, deliberately: a run named in a bump note has been
    // dispositioned by anyone reading the file, and demanding a second mention
    // in one blessed section would fail an honest record.
    const result = checkBaselineDisposition({
      methodologyText: methodology(
        `## Bump note\n\nMeasured against \`${NEWER}\`.`,
      ),
      runIds: [OLDER, STANDING, NEWER],
    });

    expect(result.kind).toBe('ok');
  });

  it('fails when a newer run is named nowhere', () => {
    const result = checkBaselineDisposition({
      methodologyText: methodology(),
      runIds: [STANDING, NEWER],
    });

    expect(result).toEqual({
      kind: 'undispositioned',
      standingPoint: STANDING,
      runs: [NEWER],
    });
  });

  it('ignores runs older than the standing point', () => {
    // An older unmentioned run is not evidence of anything: the standing point
    // moved past it, which is the disposition.
    const result = checkBaselineDisposition({
      methodologyText: methodology(),
      runIds: [OLDER, STANDING],
    });

    expect(result.kind).toBe('ok');
  });

  it('does not require the newest run to be the standing point', () => {
    // The assertion this check deliberately does not make. Not every run is
    // accepted as a baseline, so "newest == recorded" would fire on every
    // exploratory run and be silenced.
    const result = checkBaselineDisposition({
      methodologyText: methodology(`\`${NEWER}\` ran and was not accepted.`),
      runIds: [STANDING, NEWER],
    });

    expect(result.kind).toBe('ok');
  });

  it('reports an unreadable file rather than passing', () => {
    // A check that silently passes when it cannot find its own input is worse
    // than no check — and a quiet gap going unnoticed is why this exists.
    const result = checkBaselineDisposition({
      methodologyText: '## Current baseline N\n\nN = 10.',
      runIds: [NEWER],
    });

    expect(result.kind).toBe('unreadable');
  });
});
