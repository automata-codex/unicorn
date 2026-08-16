/**
 * Renders `docs/decisions.md` from the ADR corpus.
 *
 * Deterministic by construction — no timestamps, no filesystem ordering. The
 * validator's stale-index check regenerates and diffs, so any nondeterminism
 * here turns into an intermittently red CI job.
 */

import { AREA_SLUGS, AREA_TO_SECTION } from './adr.core';

import type { LoadedAdr } from './corpus';

const BANNER = [
  '<!--',
  '  GENERATED FILE — DO NOT EDIT.',
  '',
  '  Source of truth is one file per decision in `docs/decisions/`.',
  '  Edit the entry there, then run `task docs:decisions:build`.',
  '  `task docs:decisions:check` fails if this file is stale.',
  '-->',
].join('\n');

function entryHeading(adr: LoadedAdr): string {
  const { id, title } = adr.frontMatter;
  return `### [${id}](decisions/${adr.filename}) — ${title}`;
}

export function renderIndex(header: string, corpus: LoadedAdr[]): string {
  const parts: string[] = [header.trimEnd(), '', BANNER, ''];

  const open = corpus.filter((a) => a.frontMatter.status === 'open');
  if (open.length > 0) {
    parts.push('---', '', '## Open', '');
    for (const adr of open) {
      parts.push(
        `- [${adr.frontMatter.id}](decisions/${adr.filename}) — ${adr.frontMatter.title}`,
      );
    }
    parts.push('');
  }

  for (const area of AREA_SLUGS) {
    const entries = corpus.filter((a) => a.frontMatter.area === area);
    if (entries.length === 0) continue;

    parts.push('---', '', `## ${AREA_TO_SECTION.get(area)}`, '');
    for (const adr of entries) {
      parts.push(entryHeading(adr), '');
      parts.push(adr.frontMatter.summary ?? adr.body, '');
    }
  }

  return `${parts.join('\n').trimEnd()}\n`;
}
