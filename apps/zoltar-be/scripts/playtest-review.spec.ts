import { sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultOutputPath } from './playtest-review';

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
