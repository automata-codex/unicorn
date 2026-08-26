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

  // Unsettled entries surface above the area sections so a reader meets them
  // before relying on anything. `open` and `provisional` are different claims
  // and are listed separately: an open entry has decided nothing, while a
  // provisional one is in force and merely unproven.
  const unsettled: [string, 'open' | 'provisional', string][] = [
    [
      '## Open',
      'open',
      'No decision yet. Nothing here is safe to rely on.',
    ],
    [
      '## Provisional',
      'provisional',
      'Decided and in force, but on trial — follow it, and expect it may change.',
    ],
  ];
  for (const [heading, status, gloss] of unsettled) {
    const entries = corpus.filter((a) => a.frontMatter.status === status);
    if (entries.length === 0) continue;
    parts.push('---', '', heading, '', `*${gloss}*`, '');
    for (const adr of entries) {
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
