import { sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectToolSyntaxLeaks,
  defaultOutputPath,
  toolLeaksPath,
} from './playtest-review';

import type { TurnRow } from './playtest-review.render';

describe('defaultOutputPath', () => {
  let prevOverride: string | undefined;

  beforeEach(() => {
    prevOverride = process.env.PLAYTEST_REPORTS_DIR;
    delete process.env.PLAYTEST_REPORTS_DIR;
  });

  afterEach(() => {
    if (prevOverride === undefined) delete process.env.PLAYTEST_REPORTS_DIR;
    else process.env.PLAYTEST_REPORTS_DIR = prevOverride;
  });

  it('defaults to playtest-reports/ under the cwd', () => {
    const path = defaultOutputPath('adventure-1');
    expect(path).toContain(`${sep}playtest-reports${sep}adventure-1-`);
  });

  it('honors PLAYTEST_REPORTS_DIR when set', () => {
    process.env.PLAYTEST_REPORTS_DIR = '/tmp/custom-reports';
    const path = defaultOutputPath('adventure-1');
    expect(path.startsWith('/tmp/custom-reports/adventure-1-')).toBe(true);
  });

  it('ignores an empty PLAYTEST_REPORTS_DIR and falls back to the default', () => {
    process.env.PLAYTEST_REPORTS_DIR = '';
    const path = defaultOutputPath('adventure-1');
    expect(path).toContain(`${sep}playtest-reports${sep}adventure-1-`);
  });
});

describe('collectToolSyntaxLeaks', () => {
  const turn = (gmResponseSeq: number, toolSyntaxLeaks?: unknown): TurnRow =>
    ({ gmResponseSeq, telemetryPayload: { toolSyntaxLeaks } }) as TurnRow;

  it('tags each leak with the turn it came from', () => {
    const leak = {
      pass: 'tool_loop',
      rawInput: { playerText: 'x</playerText>' },
      outcome: 'rejected',
    };
    expect(
      collectToolSyntaxLeaks([turn(3, [leak]), turn(7, [leak, leak])]),
    ).toEqual([
      { gmResponseSeq: 3, ...leak },
      { gmResponseSeq: 7, ...leak },
      { gmResponseSeq: 7, ...leak },
    ]);
  });

  it('skips turns without the field, which is every row older than it', () => {
    expect(collectToolSyntaxLeaks([turn(1), turn(2, [])])).toEqual([]);
  });
});

describe('toolLeaksPath', () => {
  it('sits beside the report under the same name', () => {
    expect(toolLeaksPath('/reports/adv-1-20261004-120000.md')).toBe(
      '/reports/adv-1-20261004-120000-tool-leaks.json',
    );
  });
});
