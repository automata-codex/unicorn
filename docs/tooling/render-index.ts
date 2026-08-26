/**
 * Renders the two generated views of the ADR corpus.
 *
 * `docs/decisions.md` carries every entry in full. `docs/decisions-summary.md`
 * carries each entry's `summary` where one is written, falling back to the full
 * body where none is. Until summaries exist the two files are identical, and
 * they diverge one entry at a time as summaries are authored.
 *
 * **The full view deliberately ignores `summary`.** It used to render
 * `summary ?? body`, which meant writing a summary silently removed that
 * entry's reasoning from the only place the whole corpus could be read. The
 * split exists so that adding a summary is additive.
 *
 * Deterministic by construction — no timestamps, no filesystem ordering. The
 * validator's stale-index check regenerates and diffs, so any nondeterminism
 * here turns into an intermittently red CI job.
 */

import { AREA_SLUGS, AREA_TO_SECTION } from './adr.core';

import type { LoadedAdr } from './corpus';

export type IndexVariant = 'full' | 'summary';

function banner(): string {
  return [
    '<!--',
    '  GENERATED FILE — DO NOT EDIT.',
    '',
    '  Source of truth is one file per decision in `docs/decisions/`.',
    '  Edit the entry there, then run `task docs:decisions:build`, which',
    '  rewrites both this file and its sibling view.',
    '  `task docs:decisions:check` fails if either is stale.',
    '-->',
  ].join('\n');
}

/** One line under the header saying which view the reader has open. */
function viewNote(variant: IndexVariant, corpus: LoadedAdr[]): string {
  if (variant === 'full') {
    return `**This is the full log** — every entry in its entirety. For the short version, see [\`decisions-summary.md\`](decisions-summary.md).`;
  }
  const summarized = corpus.filter(
    (a) => a.frontMatter.summary !== null,
  ).length;
  const scope =
    summarized === 0
      ? 'No entry has a summary yet, so this file is currently identical to the full log'
      : `${summarized} of ${corpus.length} entries have a summary; the rest fall back to their full text`;
  return `**This is the summary log.** ${scope}. For the reasoning behind any entry, follow its link or see [\`decisions.md\`](decisions.md).`;
}

function entryHeading(adr: LoadedAdr): string {
  const { id, title } = adr.frontMatter;
  return `### [${id}](decisions/${adr.filename}) — ${title}`;
}

function entryBody(adr: LoadedAdr, variant: IndexVariant): string {
  if (variant === 'full') return adr.body;
  return adr.frontMatter.summary ?? adr.body;
}

export function renderIndex(
  header: string,
  corpus: LoadedAdr[],
  variant: IndexVariant = 'full',
): string {
  const parts: string[] = [
    header.trimEnd(),
    '',
    banner(),
    '',
    viewNote(variant, corpus),
    '',
  ];

  // Unsettled entries surface above the area sections so a reader meets them
  // before relying on anything. `open` and `provisional` are different claims
  // and are listed separately: an open entry has decided nothing, while a
  // provisional one is in force and merely unproven.
  const unsettled: [string, 'open' | 'provisional', string][] = [
    ['## Open', 'open', 'No decision yet. Nothing here is safe to rely on.'],
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
      parts.push(entryBody(adr, variant), '');
    }
  }

  return `${parts.join('\n').trimEnd()}\n`;
}
