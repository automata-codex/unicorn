#!/usr/bin/env tsx
/**
 * `eval:primer-audit` — check the Warden primer's declarations against the book.
 *
 * Run it after every primer edit, not only when something looks wrong. Six
 * errors were found across five revisions in three days and three of them sat
 * in text that read perfectly well (`docs/rules-extraction-findings.md
 * § S26.4`).
 *
 * It checks invariants, not prose. No script decides whether "AP is a
 * threshold, not a pool" is a fair reading of p.28 — it decides whether the
 * primer maps a term the book uses verbatim, or declares a mechanic absent
 * that the table of contents names. Those are the errors that got past human
 * review.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/primer-audit.ts \
 *     [--primer <path>] [--headings <path>] [--system mothership] [--output <path>]
 *
 * Or via the task wrapper:
 *   task eval:primer-audit
 *
 * **Supply `--headings` or the absence checks are weak.** `SectionHeader`
 * blocks are excluded from the index, so no corpus query can see them, and
 * judging "the book has no rule for X" from the corpus alone already produced
 * one wrong conclusion (`§ S9.1`'s `surprise`). Produce the file once with:
 *
 *   task ingest -- --system mothership --pdf <path> --dump-headings <path>
 *
 * It is a cache keyed to the source document — headings change only when the
 * book or marker does.
 *
 * Needs `DATABASE_URL` and a populated index. No Anthropic calls, no Voyage
 * calls. Exits non-zero when an invariant is violated, so it can gate a
 * commit. Plain `tsx` — no Nest DI.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { hashPromptText } from '../src/wardens/prompt-paths';

import {
  auditPrimer,
  parsePrimer,
  renderAuditReport,
  unmentionedHeadings,
  usesTerm,
} from './primer-audit.core';

import type { Db } from '../src/db/db.provider';
import type { TermPresence } from './primer-audit.core';

const DEFAULT_SYSTEM = 'mothership';
const DEFAULT_PRIMER = join(
  __dirname,
  '..',
  'src',
  'wardens',
  'prompts',
  'mothership-m7.txt',
);

/**
 * Where `ingest.py --dump-headings` is expected to have written.
 *
 * Defaulted rather than required for the same reason `readIndexProvenance`
 * defaults to `.ingest-manifest.json`: the file is a per-machine cache beside
 * the pipeline that produced it, and making the caller pass a path invites the
 * relative-path mistake — `task ingest` runs with `dir: ingestion`, so a path
 * that looks right from the repo root lands one directory deeper.
 */
function defaultHeadingsPath(system: string): string {
  return join(
    __dirname,
    '..',
    '..',
    '..',
    'ingestion',
    `.headings-${system}.json`,
  );
}

interface HeadingFile {
  headings?: Array<{ physicalPage: number; text: string }>;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      primer: { type: 'string' },
      headings: { type: 'string' },
      system: { type: 'string' },
      output: { type: 'string' },
    },
  });

  const primerPath = values.primer ?? DEFAULT_PRIMER;
  const system = values.system ?? DEFAULT_SYSTEM;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 2;
  }

  let primerText: string;
  try {
    primerText = await readFile(primerPath, 'utf8');
  } catch {
    process.stderr.write(`cannot read the primer at ${primerPath}\n`);
    return 2;
  }

  // An explicit --headings that cannot be read is an error; the default one
  // missing is not, because the audit still runs usefully without it and says
  // so in the report.
  const headingsPath = values.headings ?? defaultHeadingsPath(system);
  let headings: Array<{ physicalPage: number; text: string }> | null = null;
  try {
    const parsed = JSON.parse(
      await readFile(headingsPath, 'utf8'),
    ) as HeadingFile;
    headings = parsed.headings ?? [];
  } catch {
    if (values.headings) {
      process.stderr.write(`cannot read the heading list at ${headingsPath}\n`);
      return 2;
    }
    process.stderr.write(
      `no heading list at ${headingsPath} — absence checks will be weak. ` +
        'Produce one with: task ingest -- --system ' +
        system +
        ' --pdf <path> --dump-headings .headings-' +
        system +
        '.json\n',
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool) as unknown as Db;

  try {
    const systems = await db.execute<{ id: string }>(
      sql`SELECT id FROM game_system WHERE slug = ${system}`,
    );
    const systemId = systems.rows[0]?.id;
    if (!systemId) {
      process.stderr.write(`no game_system with slug "${system}"\n`);
      return 2;
    }

    // Pull the corpus once — 61 chunks, so a per-term round trip would be
    // slower and no more accurate. Matching goes through `usesTerm` rather
    // than `String.includes`: "DC" matched inside "Handcuffs" and "search"
    // inside "research" on the first run of this audit.
    const chunks = await db.execute<{ content: string }>(
      sql`SELECT content FROM rules_chunk WHERE system_id = ${systemId}`,
    );
    if (chunks.rows.length === 0) {
      process.stderr.write(
        `the rules index is empty for "${system}", so every term would read as ` +
          'absent and every absence claim would falsely pass.\n',
      );
      return 1;
    }
    const corpus = chunks.rows.map((r) => r.content.toLowerCase()).join('\n');
    const headingText = (headings ?? []).map((h) => h.text.toLowerCase());

    const presenceOf = (term: string): TermPresence => {
      const needle = term.toLowerCase();
      const hits = headingText
        .map((h, i) => (usesTerm(h, needle) ? (headings as never[])[i] : null))
        .filter(Boolean) as unknown as Array<{ text: string }>;
      return {
        inCorpus: usesTerm(corpus, needle),
        inHeadings: headings === null ? null : hits.length > 0,
        headingHits: hits.map((h) => h.text),
      };
    };

    const primer = parsePrimer(primerText);
    const findings = auditPrimer(primer, presenceOf);
    const report = renderAuditReport({
      primerPath,
      primerHash: hashPromptText(primerText),
      findings,
      unmentioned:
        headings === null ? [] : unmentionedHeadings(primerText, headings),
      headingCount: headings === null ? null : headings.length,
      mappingCount: primer.mappings.length,
      absentCount: primer.absentMechanics.length,
    });

    if (values.output) {
      await mkdir(dirname(values.output), { recursive: true });
      await writeFile(values.output, report, 'utf8');
      process.stderr.write(`report written to ${values.output}\n`);
    } else {
      process.stdout.write(report);
    }

    // Non-zero on violation so this can gate a commit. Warnings do not fail:
    // "the word appears in the corpus" is a prompt to look, not a defect.
    return findings.some((f) => f.severity === 'error') ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
