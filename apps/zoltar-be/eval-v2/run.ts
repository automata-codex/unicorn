/**
 * `task ev2:run` — replays each labeled case N times through the real turn
 * code and writes what the Warden said to disk. Grades nothing: the
 * maintainer marks `marks.csv` by hand, then `task ev2:report` tallies it.
 *
 * Writes to the database `DATABASE_URL` names and makes real Anthropic calls:
 * cases × reps Warden turns.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadFixture } from './fixture';
import {
  bootApp,
  findPrereqs,
  runTurn,
  seedScratch,
  teardownScratch,
} from './replay';
import {
  pad,
  parseArgs,
  renderCaseMd,
  renderMarksCsv,
  renderRepMd,
} from './run.core';

import type { MarkRow } from './run.core';

function git(command: string): string {
  return execSync(`git ${command}`, { encoding: 'utf8' }).trim();
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const root = process.env.ZOLTAR_EVAL_ROOT;
  if (!root) throw new Error('ZOLTAR_EVAL_ROOT is not set.');

  // Preflight: everything that can fail without spending anything fails
  // here, before the first Warden turn.
  const fixtures = args.fixtureIds.map(loadFixture);
  const app = await bootApp();

  try {
    const prereqs = await findPrereqs(app.db);

    const startedAt = new Date();
    const runId = startedAt
      .toISOString()
      .replace(/\.\d+Z$/, 'Z')
      .replace(/:/g, '-');
    const runDir = join(root, 'eval-v2-runs', runId);
    mkdirSync(runDir, { recursive: true });

    const runInfo = {
      runId,
      question: args.question,
      reps: args.reps,
      fixtures: args.fixtureIds,
      commit: git('rev-parse HEAD'),
      dirty: git('status --porcelain') !== '',
      prompt: app.prompt,
      startedAt: startedAt.toISOString(),
    };
    writeJson(join(runDir, 'run.json'), runInfo);

    console.log(`Run ${runId}`);
    console.log(`  prompt ${app.prompt.filename} (${app.prompt.hash})`);
    console.log(
      `  ${fixtures.length} case(s) × ${args.reps} rep(s) = ${fixtures.length * args.reps} Warden turn(s)`,
    );

    const marks: MarkRow[] = [];

    for (const fixture of fixtures) {
      const caseDir = join(runDir, fixture.id);
      mkdirSync(caseDir);
      writeFileSync(join(caseDir, 'case.md'), renderCaseMd(fixture));

      for (let rep = 1; rep <= args.reps; rep++) {
        const base = join(caseDir, `rep-${pad(rep)}`);
        const began = Date.now();
        let mark: MarkRow['mark'] = '';

        const scratch = await seedScratch(
          app.db,
          fixture,
          prereqs,
          `__ev2__${fixture.id}__${runId}__${pad(rep)}`,
        );
        try {
          const result = await runTurn(app.sessionService, fixture, scratch);
          writeJson(`${base}.json`, { ok: true, result });
          writeFileSync(
            `${base}.md`,
            renderRepMd(fixture.id, rep, result.message.content),
          );
        } catch (err) {
          // A turn that threw is not a wrong answer. It is recorded as an
          // error, kept out of the pass rate, and the run carries on.
          mark = 'error';
          const error =
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : { message: String(err) };
          writeJson(`${base}.json`, { ok: false, error });
          writeFileSync(
            `${base}.md`,
            renderRepMd(fixture.id, rep, `**Turn threw:** ${error.message}`),
          );
        } finally {
          await teardownScratch(app.db, scratch.campaignId);
        }

        marks.push({ fixtureId: fixture.id, rep, mark });
        const seconds = Math.round((Date.now() - began) / 1000);
        console.log(
          `  ${fixture.id} rep ${pad(rep)}/${pad(args.reps)} ${mark || 'ok'} (${seconds}s)`,
        );
      }
    }

    // Written last, so an interrupted run has no marks file to report on.
    writeFileSync(join(runDir, 'marks.csv'), renderMarksCsv(marks));
    writeJson(join(runDir, 'run.json'), {
      ...runInfo,
      endedAt: new Date().toISOString(),
    });

    const errors = marks.filter((m) => m.mark === 'error').length;
    console.log(`\nWrote ${runDir}`);
    console.log(`  ${marks.length} rep(s), ${errors} error(s)`);
    console.log('  Next: fill in marks.csv (pass / fail / na), then');
    console.log(`  task ev2:report -- ${runDir}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
