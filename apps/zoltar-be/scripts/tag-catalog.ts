#!/usr/bin/env tsx
/**
 * Generates a catalog of every eval failure-mode tag — what it means, how it
 * is graded, and which fixtures carry it.
 *
 * **Static. No database, no API calls, no cost.** It reads the check registry,
 * the rubric registry and the fixture files on disk. Safe to run at any time;
 * it is a `cat` with a table of contents, not a harness invocation.
 *
 * The structured half is *imported* rather than parsed, so it cannot go stale:
 * `evalChecks` is the same `buildChecks()` output the harness selects from, and
 * importing it runs the registry's own consistency assertions. A registry that
 * would refuse a run also refuses to produce this catalog.
 *
 * The prose half — the "why this tag exists" notes — lives in comments on the
 * `failureModeTagSchema` enum and has no runtime representation, so it is
 * lifted from the source text. That extraction is best-effort by construction:
 * a tag whose comment cannot be found renders as `_(no registry note)_` rather
 * than failing, because a missing note is a documentation gap and not a reason
 * to withhold the rest of the catalog.
 *
 * Usage:
 *   npx tsx scripts/tag-catalog.ts [--json] [--output <path>]
 *
 * Or via the task wrapper:
 *   task docs:eval-tags
 *   task docs:eval-tags -- --output ../../docs/eval-tags.md
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  failureModeTagSchema,
  judgedFailureModeTags,
  structuralFailureModeTags,
} from '../eval/fixture.schema';
import { evalChecks, rubricTextFor } from '../eval/checks/registry';
import { judgeRubrics } from '../eval/checks/judged/rubrics';

const FIXTURES_DIR = join(__dirname, '..', 'eval', 'fixtures');
const SCHEMA_SRC = join(__dirname, '..', 'eval', 'fixture.schema.ts');

interface TagUsage {
  /** Fixtures whose own `tag` field names this tag. */
  taggedBy: string[];
  /** Fixtures that attach this check through `applicability`, tagged otherwise. */
  attachedBy: string[];
}

/**
 * Lifts the comment block preceding each tag literal inside
 * `failureModeTagSchema`. Line comments and block comments both, joined into
 * one paragraph — the enum's notes are prose, and their line breaks are
 * accidents of the 80-column source rather than structure worth keeping.
 */
function readRegistryNotes(): Map<string, string> {
  const src = readFileSync(SCHEMA_SRC, 'utf-8');
  const start = src.indexOf('export const failureModeTagSchema');
  const end = src.indexOf(']);', start);
  if (start === -1 || end === -1) return new Map();

  const notes = new Map<string, string>();
  let buffer: string[] = [];

  for (const raw of src.slice(start, end).split('\n')) {
    const line = raw.trim();
    const comment = line.startsWith('//')
      ? line.replace(/^\/\/\s?/, '')
      : line.startsWith('*') || line.startsWith('/*')
        ? line.replace(/^\/?\*+\/?\s?/, '')
        : null;

    if (comment !== null) {
      if (comment.length > 0) buffer.push(comment);
      continue;
    }

    const tag = line.match(/^'([A-Z0-9-]+)',?$/)?.[1];
    if (tag) {
      if (buffer.length > 0) notes.set(tag, buffer.join(' ').trim());
      buffer = [];
    } else if (line.length > 0) {
      buffer = [];
    }
  }

  return notes;
}

function readFixtureUsage(): Map<string, TagUsage> {
  const usage = new Map<string, TagUsage>();
  const ensure = (tag: string): TagUsage => {
    const existing = usage.get(tag);
    if (existing) return existing;
    const fresh: TagUsage = { taggedBy: [], attachedBy: [] };
    usage.set(tag, fresh);
    return fresh;
  };

  for (const file of readdirSync(FIXTURES_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    const parsed = JSON.parse(
      readFileSync(join(FIXTURES_DIR, file), 'utf-8'),
    ) as { id?: string; tag?: string; applicability?: Record<string, unknown> };
    const id = parsed.id ?? file;

    if (parsed.tag) ensure(parsed.tag).taggedBy.push(id);

    for (const checkId of Object.keys(parsed.applicability ?? {})) {
      const check = evalChecks[checkId];
      // An applicability entry naming this fixture's own tag is the tag link,
      // not a separate attachment — `selectChecksForFixture` skips it too.
      if (!check || check.tag === parsed.tag) continue;
      ensure(check.tag).attachedBy.push(id);
    }
  }

  return usage;
}

/**
 * Renders rubric text as a markdown blockquote rather than a fenced block.
 * The rubrics are prose carrying their own inline markup — `**emphasis**`,
 * code spans around field names — and a fence would render all of it as
 * monospace source, which is the one presentation that hides what the emphasis
 * was for.
 *
 * A blank line inside the quote carries its own `>`. Left empty it terminates
 * the block, and every paragraph after the first renders as body text — a
 * multi-paragraph rubric then looks like it stopped after its first sentence.
 */
function asBlockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim().length === 0 ? '>' : `> ${line}`))
    .join('\n');
}

/** What a `not_applicable` from this check actually means to a reader. */
const SOURCE_MEANING: Record<string, string> = {
  fixture:
    'fixture-authored — every rep agrees, so a partial applicability rate is a defect',
  artifact:
    "gates on the turn's own output — the denominator moves with what the Warden did; read alongside the exclusion count",
  ungated: 'reaches a verdict on every rep; a `not_applicable` should not occur',
};

function flagsFor(checkId: string): string {
  const check = evalChecks[checkId];
  const flags: string[] = [];
  if (check.universal) flags.push('universal');
  if (check.tagIndependent) flags.push('tag-independent');
  if (check.stub) flags.push('**stub — refuses any run selecting it**');
  if (check.judgeGate) flags.push('has judge gate');
  if (check.judgeContext) flags.push('has judgeContext (unhashed — `ADR-0105`)');
  if (check.requiresFixtureSchema !== undefined) {
    flags.push(`fixtureSchemaVersion >= ${check.requiresFixtureSchema}`);
  }
  return flags.length > 0 ? flags.join(', ') : '—';
}

function buildCatalog(): string {
  const notes = readRegistryNotes();
  const usage = readFixtureUsage();
  const tags = [...failureModeTagSchema.options].sort();

  const out: string[] = [];
  out.push('# Eval Failure-Mode Tag Catalog');
  out.push('');
  out.push(
    `Generated by \`scripts/tag-catalog.ts\` on ${new Date().toISOString().slice(0, 10)} — ` +
      'do not edit by hand.',
  );
  out.push('');
  out.push(
    `**${tags.length} tags** — ${structuralFailureModeTags.length} structural, ` +
      `${judgedFailureModeTags.length} judged. Structural checks are deterministic and free; ` +
      'judged checks spend one Claude call per fixture-rep.',
  );
  out.push('');

  out.push('## Coverage');
  out.push('');
  out.push('| Tag | Mode | Applicability | Fixtures tagged | Also attached | Flags |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const tag of tags) {
    const checkId = tag.toLowerCase();
    const check = evalChecks[checkId];
    const u = usage.get(tag) ?? { taggedBy: [], attachedBy: [] };
    const tagged = u.taggedBy.length === 0 ? '**0**' : String(u.taggedBy.length);
    out.push(
      `| \`${tag}\` | ${check?.mode ?? '—'} | ${check?.applicabilitySource ?? '—'} | ` +
        `${tagged} | ${u.attachedBy.length} | ${check ? flagsFor(checkId) : '—'} |`,
    );
  }
  out.push('');

  const uncovered = tags.filter((t) => (usage.get(t)?.taggedBy.length ?? 0) === 0);
  out.push('## Registered but never captured');
  out.push('');
  if (uncovered.length === 0) {
    out.push('_Every tag has at least one fixture._');
  } else {
    out.push(
      'These tags are registered and (presumably) unit-tested, but no fixture carries them, ' +
        'so they produce no denominator in a run. A tag here reads as uncovered, not as passing.',
    );
    out.push('');
    for (const tag of uncovered) {
      const attached = usage.get(tag)?.attachedBy.length ?? 0;
      const via =
        evalChecks[tag.toLowerCase()]?.universal === true
          ? ' — universal, so it runs on every fixture regardless'
          : attached > 0
            ? ` — but attached to ${attached} fixture(s) via \`applicability\``
            : '';
      out.push(`- \`${tag}\`${via}`);
    }
  }
  out.push('');

  out.push('## Tags');
  out.push('');
  for (const tag of tags) {
    const checkId = tag.toLowerCase();
    const check = evalChecks[checkId];
    const u = usage.get(tag) ?? { taggedBy: [], attachedBy: [] };

    out.push(`### \`${tag}\``);
    out.push('');
    if (!check) {
      out.push('_No registered check — this tag cannot be selected._');
      out.push('');
      continue;
    }

    out.push(`- **Check id:** \`${checkId}\``);
    out.push(`- **Mode:** ${check.mode}`);
    out.push(
      `- **Applicability source:** \`${check.applicabilitySource}\` — ` +
        `${SOURCE_MEANING[check.applicabilitySource] ?? 'see registry'}`,
    );
    out.push(`- **Flags:** ${flagsFor(checkId)}`);
    if (check.mode === 'judged') {
      const required = judgeRubrics[tag as keyof typeof judgeRubrics]?.requiredFacts ?? [];
      out.push(`- **Rubric hash:** \`${check.rubricHash?.() ?? '—'}\``);
      out.push(
        `- **Required facts:** ${
          required.length === 0
            ? '_none_ — a rubric revision is scoring-only and costs no `corpusVersion` bump'
            : required.map((f) => `\`${f}\``).join(', ')
        }`,
      );
    }
    out.push(
      `- **Fixtures tagged:** ${
        u.taggedBy.length === 0
          ? '_none_'
          : u.taggedBy.map((f) => `\`${f}\``).join(', ')
      }`,
    );
    if (u.attachedBy.length > 0) {
      out.push(
        `- **Also attached via applicability:** ${u.attachedBy.map((f) => `\`${f}\``).join(', ')}`,
      );
    }
    out.push('');

    out.push(`**Registry note.** ${notes.get(tag) ?? '_(no registry note)_'}`);
    out.push('');

    if (check.mode === 'judged') {
      out.push('**Rubric.**');
      out.push('');
      out.push(asBlockquote(rubricTextFor(checkId)));
      out.push('');
    }
  }

  return out.join('\n');
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { json: { type: 'boolean', default: false }, output: { type: 'string' } },
  });

  const payload = values.json
    ? `${JSON.stringify(
        [...failureModeTagSchema.options].sort().map((tag) => {
          const check = evalChecks[tag.toLowerCase()];
          const usage = readFixtureUsage().get(tag);
          return {
            tag,
            checkId: check?.id ?? null,
            mode: check?.mode ?? null,
            applicabilitySource: check?.applicabilitySource ?? null,
            universal: check?.universal === true,
            tagIndependent: check?.tagIndependent === true,
            stub: check?.stub === true,
            requiresFixtureSchema: check?.requiresFixtureSchema ?? null,
            hasJudgeGate: check?.judgeGate !== undefined,
            hasJudgeContext: check?.judgeContext !== undefined,
            rubricHash: check?.rubricHash?.() ?? null,
            requiredFacts:
              judgeRubrics[tag as keyof typeof judgeRubrics]?.requiredFacts ?? null,
            fixturesTagged: usage?.taggedBy ?? [],
            fixturesAttached: usage?.attachedBy ?? [],
          };
        }),
        null,
        2,
      )}\n`
    : `${buildCatalog()}\n`;

  if (values.output) {
    writeFileSync(values.output, payload);
    process.stdout.write(`wrote ${values.output}\n`);
  } else {
    process.stdout.write(payload);
  }
}

main();
