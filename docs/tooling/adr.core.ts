/**
 * Pure logic for the ADR corpus: front matter, slugs, and the splitter that
 * turns the legacy single-file decisions log into one file per decision.
 *
 * No filesystem access lives here — everything takes and returns strings or
 * plain objects, so the tests need no fixtures on disk. The CLI wrappers
 * (`build-index.ts`, `check.ts`, `missing-summaries.ts`) do the I/O.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

/** The 13 area slugs, one per `##` section of the legacy log. */
export const AREA_SLUGS = [
  'architecture-backend',
  'rules-ingestion',
  'rules-retrieval',
  'claude-tool-schemas-state',
  'claude-turn-loop-correction',
  'claude-continuity-spatial',
  'api-data-model',
  'frontend-design-system',
  'oracle-tables',
  'eval-harness',
  'monorepo-tooling-deployment',
  'licensing-business',
  'security',
] as const;

export type AreaSlug = (typeof AREA_SLUGS)[number];

/**
 * Legacy `##` heading text to area slug. Written out rather than derived by
 * slugifying the heading: a heading reword should fail loudly here instead of
 * silently reassigning every entry beneath it to a new area.
 *
 * The order of this map is also the section order the generated index renders
 * in, so it must stay in document order.
 */
export const SECTION_TO_AREA: ReadonlyMap<string, AreaSlug> = new Map([
  ['Architecture & Backend', 'architecture-backend'],
  ['Rules Ingestion', 'rules-ingestion'],
  ['Rules Retrieval', 'rules-retrieval'],
  ['Claude Integration — Tool Schemas & State', 'claude-tool-schemas-state'],
  [
    'Claude Integration — Turn Loop & Correction',
    'claude-turn-loop-correction',
  ],
  ['Claude Integration — Continuity & Spatial', 'claude-continuity-spatial'],
  ['API & Data Model', 'api-data-model'],
  ['Frontend & Design System', 'frontend-design-system'],
  ['Oracle Tables', 'oracle-tables'],
  ['Eval Harness', 'eval-harness'],
  ['Monorepo, Tooling & Deployment', 'monorepo-tooling-deployment'],
  ['Licensing & Business Strategy', 'licensing-business'],
  ['Security', 'security'],
]);

/** Area slug back to the heading the generated index renders for it. */
export const AREA_TO_SECTION: ReadonlyMap<AreaSlug, string> = new Map(
  [...SECTION_TO_AREA].map(([heading, slug]) => [slug, heading]),
);

export const ADR_ID_PATTERN = /^ADR-\d{4}$/;

/** A bare identifier token as it appears in prose. */
export const ADR_TOKEN_PATTERN = /ADR-\d{4}/g;

export const frontMatterSchema = z
  .object({
    id: z.string().regex(ADR_ID_PATTERN, 'id must look like ADR-0001'),
    title: z.string().min(1),
    area: z.enum(AREA_SLUGS),
    status: z.enum(['accepted', 'open', 'superseded']),
    superseded_by: z.string().regex(ADR_ID_PATTERN).nullable(),
    milestone: z.string().min(1),
    summary: z.string().min(1).nullable(),
  })
  .strict()
  .refine((fm) => fm.status !== 'superseded' || fm.superseded_by !== null, {
    message: 'status: superseded requires a superseded_by',
    path: ['superseded_by'],
  })
  .refine((fm) => fm.superseded_by !== fm.id, {
    message: 'superseded_by must not point at itself',
    path: ['superseded_by'],
  });

export type FrontMatter = z.infer<typeof frontMatterSchema>;

export interface AdrFile {
  frontMatter: FrontMatter;
  body: string;
}

/** `ADR-0042` -> 42. */
export function idToNumber(id: string): number {
  return Number.parseInt(id.slice(4), 10);
}

/** 42 -> `ADR-0042`. */
export function numberToId(n: number): string {
  return `ADR-${String(n).padStart(4, '0')}`;
}

/**
 * Title to filename slug. Cosmetic — the number is what addresses the entry —
 * but it has to be stable, because the validator checks the filename number
 * against the front matter and a churning slug means churning filenames.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[`*]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '');
}

export function adrFilename(id: string, title: string): string {
  return `${id.slice(4)}-${slugify(title)}.md`;
}

/**
 * Split an ADR file into front matter and body.
 *
 * Only the first two `---` lines delimit. Entry bodies legitimately contain
 * `---` horizontal rules (three of them in the legacy log), and a reader that
 * splits on every `---` truncates those bodies silently.
 */
export function parseAdrFile(text: string): AdrFile {
  const lines = text.split('\n');
  if (lines[0] !== '---') {
    throw new Error('file does not begin with front matter');
  }
  const close = lines.indexOf('---', 1);
  if (close === -1) {
    throw new Error('front matter is not terminated');
  }
  const raw = parseYaml(lines.slice(1, close).join('\n'));
  const frontMatter = frontMatterSchema.parse(raw);
  // +1 to drop the blank line that always follows the closing delimiter. The
  // trailing newline the file ends with is not part of the body, so the
  // round trip through serializeAdrFile is exact.
  const body = lines
    .slice(close + 2)
    .join('\n')
    .replace(/\n+$/, '');
  return { frontMatter, body };
}

export function serializeAdrFile(file: AdrFile): string {
  // The yaml library quotes as needed. Do not hand-format this: 11 titles
  // contain a colon, 5 contain a quote character, and 38 contain backticks.
  const fm = stringifyYaml(file.frontMatter, { lineWidth: 0 });
  return `---\n${fm}---\n\n${file.body}\n`;
}

export interface SplitEntry {
  area: AreaSlug;
  title: string;
  body: string;
}

export interface SplitResult {
  preamble: string;
  entries: SplitEntry[];
}

/**
 * Strip trailing blank lines and trailing horizontal rules from an entry body.
 *
 * The legacy log puts a `---` before every `##` section heading, and before
 * three `###` entry headings (an inconsistency introduced during M7.6). A
 * naive `^### ` split absorbs each of those into the *preceding* entry. Both
 * kinds are separators rather than content, so both come off here and the
 * index compiler emits its own separators uniformly.
 */
function trimBody(lines: string[]): string {
  const out = [...lines];
  while (out.length > 0) {
    const last = out[out.length - 1].trim();
    if (last === '' || last === '---') {
      out.pop();
      continue;
    }
    break;
  }
  // The blank line that follows every `### ` heading is structure, not body.
  while (out.length > 0 && out[0].trim() === '') {
    out.shift();
  }
  return out.join('\n');
}

/**
 * Split the legacy decisions log into a preamble and one record per `###`.
 *
 * Fence tracking is defensive: the current log has no `### ` inside a code
 * fence, but this compiler outlives the migration and a future entry that
 * pastes a markdown sample would otherwise split in the middle.
 */
export function splitDecisionsLog(text: string): SplitResult {
  const lines = text.split('\n');

  const firstSection = lines.findIndex((l) => l.startsWith('## '));
  if (firstSection === -1) {
    throw new Error('no `## ` section heading found');
  }
  const preamble = lines.slice(0, firstSection).join('\n').trimEnd();

  const entries: SplitEntry[] = [];
  let area: AreaSlug | null = null;
  let title: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (title === null) return;
    if (area === null) {
      throw new Error(`entry "${title}" has no enclosing section`);
    }
    entries.push({ area, title, body: trimBody(buffer) });
    title = null;
    buffer = [];
  };

  for (const line of lines.slice(firstSection)) {
    if (line.startsWith('```')) {
      inFence = !inFence;
    }

    if (!inFence && line.startsWith('## ')) {
      flush();
      const heading = line.slice(3).trim();
      const slug = SECTION_TO_AREA.get(heading);
      if (!slug) {
        throw new Error(
          `unknown section heading "${heading}" — add it to SECTION_TO_AREA`,
        );
      }
      area = slug;
      continue;
    }

    if (!inFence && line.startsWith('### ')) {
      flush();
      title = line.slice(4).trim();
      continue;
    }

    if (title !== null) {
      buffer.push(line);
    }
  }
  flush();

  return { preamble, entries };
}
