/**
 * `task ev2:judge` — marks every narration of one run under Rubric v1 and
 * writes the marks to `judge.<prompt hash>.csv` in the run directory
 * (spec 028). `task ev2:judge-check` then sets them against the hand marks.
 *
 * Makes real Anthropic calls: one per narration. No database.
 *
 * Never reads or writes `marks.csv`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

import {
  buildJudgeRequest,
  JUDGE_MODEL,
  JUDGE_QUESTION,
  JUDGE_RUBRIC,
  judgeFileName,
  parseArgs,
  parseCaseMd,
  parseJudgeAnswer,
  parseRepMd,
  promptHash,
  renderJudgeCsv,
  STARTS,
} from './judge.core';
import { resolveRunDir } from './report';

import type { JudgeRow } from './judge.core';

const RUBRIC_PATH = join(__dirname, 'judge-rubric-q1-v1.txt');

interface Rep {
  rep: string;
  narration: string;
}

/** A case's reps that have a narration; a turn that threw has none. */
function readReps(caseDir: string): { reps: Rep[]; threw: number } {
  const reps: Rep[] = [];
  let threw = 0;
  for (const file of readdirSync(caseDir).sort()) {
    const match = /^rep-(\d+)\.md$/.exec(file);
    if (!match) continue;
    const result = JSON.parse(
      readFileSync(join(caseDir, `rep-${match[1]}.json`), 'utf8'),
    ) as { ok: boolean };
    if (!result.ok) {
      threw++;
      continue;
    }
    reps.push({
      rep: match[1],
      narration: parseRepMd(readFileSync(join(caseDir, file), 'utf8')),
    });
  }
  return { reps, threw };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolveRunDir(args.run);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');

  const info = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as {
    question: string;
    fixtures: string[];
  };
  if (info.question !== JUDGE_QUESTION) {
    throw new Error(
      `this judge marks ${JUDGE_QUESTION}; the run is of ${info.question}`,
    );
  }

  const unknown = (args.fixtureIds ?? []).filter(
    (id) => !info.fixtures.includes(id),
  );
  if (unknown.length > 0) {
    throw new Error(`not a case of this run: ${unknown.join(', ')}`);
  }

  const rubric = readFileSync(RUBRIC_PATH, 'utf8');
  const identity = {
    question: JUDGE_QUESTION,
    rubric: JUDGE_RUBRIC,
    prompt: promptHash(rubric),
    model: JUDGE_MODEL,
  };
  const outPath = join(runDir, judgeFileName(identity.prompt));
  if (existsSync(outPath)) {
    throw new Error(
      `${outPath} exists — this run has been judged with this prompt already.`,
    );
  }

  const wanted = args.fixtureIds ?? info.fixtures;
  const noStart = wanted.filter((id) => STARTS[id] === undefined);
  const cases = wanted
    .filter((id) => STARTS[id] !== undefined)
    .map((fixtureId) => {
      const caseDir = join(runDir, fixtureId);
      return {
        fixtureId,
        caseText: parseCaseMd(readFileSync(join(caseDir, 'case.md'), 'utf8')),
        ...readReps(caseDir),
      };
    });

  const total = cases.reduce((sum, c) => sum + c.reps.length, 0);
  const threw = cases.reduce((sum, c) => sum + c.threw, 0);
  console.log(`Judging ${runDir}`);
  console.log(
    `  judge ${identity.question} rubric ${identity.rubric}, prompt ${identity.prompt}, ${identity.model}`,
  );
  console.log(`  ${total} narration(s) = ${total} Anthropic call(s)`);
  if (threw > 0) console.log(`  ${threw} rep(s) threw and are skipped`);
  for (const id of noStart) console.log(`  skipped, no start recorded: ${id}`);

  const client = new Anthropic({ apiKey });
  const rows: JudgeRow[] = [];

  for (const c of cases) {
    for (const { rep, narration } of c.reps) {
      const message = await client.messages.create(
        buildJudgeRequest({
          rubric,
          fixtureId: c.fixtureId,
          caseText: c.caseText,
          narration,
        }),
      );
      const answer = parseJudgeAnswer(message);
      rows.push({
        fixtureId: c.fixtureId,
        rep,
        mark: answer.mark,
        note: answer.reason,
      });
      console.log(`  ${c.fixtureId} rep ${rep} ${answer.mark}`);
    }
  }

  // Written last, so an interrupted run leaves no judge file to check.
  writeFileSync(outPath, renderJudgeCsv(identity, rows));
  console.log(`\nWrote ${outPath}`);
  console.log(`  Next: task ev2:judge-check -- ${args.run}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
