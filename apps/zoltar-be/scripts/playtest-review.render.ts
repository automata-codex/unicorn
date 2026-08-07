import { rereadPromptFile } from '../src/wardens/prompt-paths';

import type {
  AdventureTelemetryPayload,
  ExecutedRollRecord,
  RulesLookupRecord,
  WardenPromptRef,
} from '../src/session/session.telemetry';
import type {
  ThresholdCrossing,
  ValidationRejection,
  ValidationResult,
} from '../src/session/session.validator';

// ---------------------------------------------------------------------------
// Input types — shaped by the query layer, consumed by the renderer only.
// ---------------------------------------------------------------------------

export interface HeaderRow {
  adventureId: string;
  campaignId: string;
  campaignName: string;
  gameSystemName: string;
  turnCount: number;
  firstTurnAt: Date;
  lastTurnAt: Date;
}

export interface TurnRow {
  gmResponseSeq: number;
  turnCreatedAt: Date;
  supersededBy: string | null;
  telemetryPayload: AdventureTelemetryPayload;
  wardenPromptFilename: string | null;
  wardenPromptHash: string | null;
}

interface SubmitGmResponseLike {
  playerText: string;
  stateChanges?: unknown;
  gmUpdates?: { notes?: string | null };
  diceRequests?: unknown[];
}

export interface CorrectionRow {
  correctionSeq: number;
  correctedAt: Date;
  originalSeq: number;
  originalResponse: SubmitGmResponseLike;
  correctedResponse: SubmitGmResponseLike;
  rejections: ValidationRejection[];
  correctionPromptTokens: number | null;
  correctionCompletionTokens: number | null;
}

export interface ReportInput {
  header: HeaderRow;
  turns: TurnRow[];
  corrections: CorrectionRow[];
}

// ---------------------------------------------------------------------------
// Renderer.
// ---------------------------------------------------------------------------

export function renderReport(input: ReportInput): string {
  const sections: string[] = [];
  sections.push(renderHeader(input.header));
  sections.push(renderPromptsUsed(input.turns));
  sections.push(renderTurns(input.turns, input.corrections));
  sections.push(renderCorrectionEvents(input.corrections));
  sections.push(renderSummary(input.turns, input.corrections));
  sections.push(renderPromptAppendix(input.turns));
  return sections.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// Header + prompt list.
// ---------------------------------------------------------------------------

function renderHeader(h: HeaderRow): string {
  const lines = [
    `# Playtest Review: ${h.campaignName}`,
    '',
    `**Adventure ID:** ${h.adventureId}`,
    `**Campaign ID:** ${h.campaignId}`,
    `**Game system:** ${h.gameSystemName}`,
    `**Turns:** ${h.turnCount}`,
    `**Date range:** ${formatTimestamp(h.firstTurnAt)} — ${formatTimestamp(h.lastTurnAt)}`,
  ];
  return lines.join('\n');
}

interface PromptUse {
  filename: string;
  hash: string;
  turns: number[];
}

function collectPromptUses(turns: TurnRow[]): PromptUse[] {
  // Key: `${filename}\x00${hash}`. Maintain insertion order so the header
  // reads in the order prompts first appeared — matches the natural narrative
  // "prompt X ran through turns N1…N2, then prompt Y took over".
  const byKey = new Map<string, PromptUse>();
  for (const t of turns) {
    if (!t.wardenPromptFilename || !t.wardenPromptHash) continue;
    const key = `${t.wardenPromptFilename}\x00${t.wardenPromptHash}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        filename: t.wardenPromptFilename,
        hash: t.wardenPromptHash,
        turns: [],
      };
      byKey.set(key, entry);
    }
    entry.turns.push(t.gmResponseSeq);
  }
  return [...byKey.values()];
}

function renderPromptsUsed(turns: TurnRow[]): string {
  const uses = collectPromptUses(turns);
  const header = '## Warden prompts used';
  if (uses.length === 0) {
    return [
      header,
      '',
      '_No Warden prompt recorded — all telemetry rows predate M7.1._',
    ].join('\n');
  }
  const bullets = uses.map((u) => {
    const range = formatSeqRange(u.turns);
    return `- \`${u.filename}\` (hash \`${u.hash}\`) — ${range}`;
  });
  return [header, '', ...bullets].join('\n');
}

function formatSeqRange(seqs: number[]): string {
  if (seqs.length === 0) return '(no turns)';
  // Collapse contiguous runs of sequence numbers into `a–b` pairs. Sequence
  // numbers aren't turn indices — they come from `game_event.sequence_number`
  // which skips over dice_roll / state_update / correction events — so runs
  // of gm_response seqs are rarely contiguous in practice. Render each seq
  // individually unless two gm_responses happen to be literally adjacent
  // (which won't happen once a turn writes dice rolls or corrections).
  const parts: string[] = [];
  let i = 0;
  while (i < seqs.length) {
    const start = seqs[i];
    let j = i;
    while (j + 1 < seqs.length && seqs[j + 1] === seqs[j] + 1) j++;
    parts.push(j === i ? `seq ${start}` : `seq ${start}–${seqs[j]}`);
    i = j + 1;
  }
  return parts.length === 1 ? parts[0] : parts.join(', ');
}

// ---------------------------------------------------------------------------
// Per-turn rendering.
// ---------------------------------------------------------------------------

function renderTurns(turns: TurnRow[], corrections: CorrectionRow[]): string {
  const lines = ['## Turns'];
  const correctionsBySeq = new Map<number, CorrectionRow>();
  for (const c of corrections) {
    correctionsBySeq.set(c.originalSeq, c);
  }
  turns.forEach((t, i) => {
    lines.push('');
    lines.push(
      renderSingleTurn(t, i + 1, correctionsBySeq.get(t.gmResponseSeq)),
    );
  });
  return lines.join('\n');
}

function renderSingleTurn(
  t: TurnRow,
  turnIndex: number,
  correction: CorrectionRow | undefined,
): string {
  const p = t.telemetryPayload;
  const parts: string[] = [];
  parts.push(`### Turn ${turnIndex}  (sequence ${t.gmResponseSeq})`);
  parts.push('');

  const promptRef =
    t.wardenPromptFilename && t.wardenPromptHash
      ? `\`${t.wardenPromptFilename}\` (hash \`${t.wardenPromptHash}\`)`
      : '_unrecorded (pre-M7.1 turn)_';
  parts.push(`**Warden:** ${promptRef}`);
  parts.push('');

  const playerMessage = (p.playerMessage ?? '').trim();
  parts.push('**Player:**');
  parts.push(
    playerMessage.length > 0
      ? blockQuote(playerMessage)
      : '> _(auto-advance from dice results — no narrative input)_',
  );
  parts.push('');

  const finalNarration =
    correction?.correctedResponse.playerText ?? p.originalResponse.playerText;
  parts.push('**Warden response:**');
  parts.push(blockQuote(finalNarration));
  parts.push('');

  parts.push('**Dice rolls:**');
  parts.push(renderDiceRolls(p.diceRolls));
  parts.push('');

  parts.push('**Rules lookups:**');
  parts.push(renderRulesLookups(p.rulesLookups));
  parts.push('');

  parts.push('**Applied state changes:**');
  parts.push(renderApplied(p.applied));
  parts.push('');

  parts.push('**Thresholds crossed:**');
  parts.push(renderThresholds(p.thresholds));
  parts.push('');

  const noteLines = renderNotes(p.notes.original, p.notes.correction);
  if (noteLines.length > 0) {
    parts.push(noteLines);
    parts.push('');
  }

  const tokens = p.originalRequest;
  parts.push(
    `**Token usage:** ${formatInt(tokens.promptTokens)} prompt / ${formatInt(tokens.completionTokens)} completion — ${p.toolLoopIterations} tool loop iteration${p.toolLoopIterations === 1 ? '' : 's'}`,
  );

  if (correction) {
    parts.push('');
    parts.push(renderInlineCorrection(correction));
  }

  return parts.join('\n');
}

function renderDiceRolls(rolls: ExecutedRollRecord[]): string {
  if (rolls.length === 0) return '_(none)_';
  const ordered = [...rolls].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber,
  );
  return ordered
    .map((r) => {
      const tag = r.source === 'player_entered' ? '[player]' : '[system]';
      const modifierPart =
        r.modifier !== 0 ? `, mod ${formatSignedInt(r.modifier)}` : '';
      const resultsPart = `[${r.results.join(', ')}]`;
      const totalPart = `total ${r.total}`;
      const idPart =
        r.source === 'player_entered' && r.requestId
          ? ` {requestId: ${r.requestId}}`
          : '';
      return `- ${tag} \`${r.notation}\` — ${r.purpose}: ${resultsPart}${modifierPart} → ${totalPart}${idPart}`;
    })
    .join('\n');
}

function renderRulesLookups(lookups: RulesLookupRecord[]): string {
  if (lookups.length === 0) return '_(none)_';
  return lookups
    .map((l) => {
      // Surfaced only when preprocessing changed the query, so a review can
      // tell a bad Warden phrasing from an over-eager trim. Absent otherwise.
      const trimmed =
        l.preprocessedQuery !== undefined
          ? `\n  - embedded as \`"${l.preprocessedQuery}"\``
          : '';
      if (l.resultCount === 0) {
        return `- \`"${l.query}"\` — 0 results ⚠️${trimmed}`;
      }
      const sim =
        l.topSimilarity !== null
          ? `, top sim ${l.topSimilarity.toFixed(3)}`
          : '';
      return `- \`"${l.query}"\` — ${l.resultCount} result${l.resultCount === 1 ? '' : 's'}${sim}${trimmed}`;
    })
    .join('\n');
}

function renderApplied(applied: ValidationResult['applied']): string {
  const bullets: string[] = [];
  for (const [name, pool] of Object.entries(applied.resourcePools)) {
    const maxPart = pool.max !== null ? ` / ${pool.max}` : '';
    bullets.push(`- pool \`${name}\` → current ${pool.current}${maxPart}`);
  }
  for (const [id, entity] of Object.entries(applied.entities)) {
    const bits: string[] = [];
    bits.push(`visible=${entity.visible}`);
    if (entity.status) bits.push(`status=${entity.status}`);
    if (entity.npcState) bits.push(`npcState="${entity.npcState}"`);
    bullets.push(`- entity \`${id}\` → ${bits.join(', ')}`);
  }
  for (const [name, flag] of Object.entries(applied.flags)) {
    bullets.push(`- flag \`${name}\` → ${flag.value} (${flag.trigger})`);
  }
  for (const [name, sc] of Object.entries(applied.scenarioState)) {
    const maxPart = sc.max !== null ? ` / ${sc.max}` : '';
    const notePart = sc.note ? ` — ${sc.note}` : '';
    bullets.push(`- scenario \`${name}\` → ${sc.current}${maxPart}${notePart}`);
  }
  for (const [key, value] of Object.entries(applied.worldFacts)) {
    bullets.push(`- fact \`${key}\` → "${value}"`);
  }
  return bullets.length === 0 ? '_(none)_' : bullets.join('\n');
}

function renderThresholds(thresholds: ThresholdCrossing[]): string {
  if (thresholds.length === 0) return '_(none)_';
  return thresholds
    .map((t) => `- \`${t.pool}\` reached ${t.finalValue} — ${t.effect}`)
    .join('\n');
}

function renderNotes(
  original: string | null,
  correction: string | null,
): string {
  const lines: string[] = [];
  if (original) lines.push(`**Warden notes:** "${original}"`);
  if (correction)
    lines.push(`**Warden notes (post-correction):** "${correction}"`);
  return lines.join('\n');
}

function renderInlineCorrection(c: CorrectionRow): string {
  const lines: string[] = [];
  lines.push('**Correction fired:**');
  lines.push('');
  lines.push(`- Rejections: ${c.rejections.length}`);
  for (const r of c.rejections) {
    lines.push(`  - ${formatRejection(r)}`);
  }
  lines.push('- Original narration:');
  lines.push(indentBlockQuote(c.originalResponse.playerText, '  '));
  lines.push('- Corrected narration:');
  lines.push(indentBlockQuote(c.correctedResponse.playerText, '  '));
  lines.push(
    `- Correction tokens: ${formatInt(c.correctionPromptTokens)} prompt / ${formatInt(c.correctionCompletionTokens)} completion`,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Correction events section (top-level).
// ---------------------------------------------------------------------------

function renderCorrectionEvents(corrections: CorrectionRow[]): string {
  const header = '## Correction events';
  if (corrections.length === 0) {
    return [header, '', '_(None.)_'].join('\n');
  }
  const body: string[] = [];
  for (const c of corrections) {
    body.push('');
    body.push(
      `### Correction at gm_response seq ${c.originalSeq} (correction seq ${c.correctionSeq})`,
    );
    body.push('');
    body.push(`**Rejections (${c.rejections.length}):**`);
    if (c.rejections.length === 0) {
      body.push('- _(none recorded)_');
    } else {
      for (const r of c.rejections) {
        body.push(`- ${formatRejection(r)}`);
      }
    }
    body.push('');
    body.push('**Original narration:**');
    body.push(blockQuote(c.originalResponse.playerText));
    body.push('');
    body.push('**Corrected narration:**');
    body.push(blockQuote(c.correctedResponse.playerText));
    body.push('');
    body.push(
      `**Correction tokens:** ${formatInt(c.correctionPromptTokens)} prompt / ${formatInt(c.correctionCompletionTokens)} completion`,
    );
  }
  return [header, ...body].join('\n');
}

function formatRejection(r: ValidationRejection): string {
  const prefix = r.path ? `\`${r.path}\` ` : '';
  const receivedRepr =
    r.received === undefined
      ? ''
      : ` (received: ${JSON.stringify(r.received)})`;
  return `${prefix}${r.reason}${receivedRepr}`.trim();
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------

function renderSummary(turns: TurnRow[], corrections: CorrectionRow[]): string {
  const lines = ['## Summary'];
  const totalTurns = turns.length;
  const totalCorrections = corrections.length;
  const correctionPct =
    totalTurns === 0 ? 0 : Math.round((totalCorrections / totalTurns) * 100);

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let iterationSum = 0;
  let iterationDen = 0;
  for (const t of turns) {
    const req = t.telemetryPayload.originalRequest;
    if (req.promptTokens !== null) totalPromptTokens += req.promptTokens;
    if (req.completionTokens !== null)
      totalCompletionTokens += req.completionTokens;
    iterationSum += t.telemetryPayload.toolLoopIterations;
    iterationDen++;
  }
  const meanIterations = iterationDen === 0 ? 0 : iterationSum / iterationDen;

  lines.push('');
  lines.push(`- **Total turns:** ${totalTurns}`);
  lines.push(
    `- **Total corrections:** ${totalCorrections}${totalTurns === 0 ? '' : ` (${correctionPct}%)`}`,
  );
  lines.push(
    `- **Total token usage:** ${totalPromptTokens.toLocaleString('en-US')} prompt / ${totalCompletionTokens.toLocaleString('en-US')} completion`,
  );
  lines.push(`- **Mean tool loop iterations:** ${meanIterations.toFixed(2)}`);

  // Zero-result rules lookup histogram. M7.2 ingestion priority signal —
  // surface the count per query.
  const zeroResultCounts = new Map<string, number>();
  for (const t of turns) {
    for (const l of t.telemetryPayload.rulesLookups) {
      if (l.resultCount === 0) {
        zeroResultCounts.set(l.query, (zeroResultCounts.get(l.query) ?? 0) + 1);
      }
    }
  }
  lines.push(
    '- **Rules lookups with zero results:**  ← M7.2 ingestion priority signal',
  );
  if (zeroResultCounts.size === 0) {
    lines.push('  - _(none)_');
  } else {
    const sorted = [...zeroResultCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [query, count] of sorted) {
      lines.push(`  - \`"${query}"\` × ${count}`);
    }
  }

  // Warden notes digest. Flat list of every non-empty gmUpdates.notes across
  // the run, tagged by turn. Correction notes are included — they represent
  // the Warden's final read for the turn.
  lines.push('- **Warden notes digest:**');
  const notes: string[] = [];
  turns.forEach((t, i) => {
    const n = t.telemetryPayload.notes;
    const turnIdx = i + 1;
    if (n.original) notes.push(`  - _turn ${turnIdx}_: "${n.original}"`);
    if (n.correction) {
      notes.push(`  - _turn ${turnIdx} (correction)_: "${n.correction}"`);
    }
  });
  if (notes.length === 0) {
    lines.push('  - _(none)_');
  } else {
    lines.push(...notes);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Prompt texts appendix — with hash-mismatch handling.
// ---------------------------------------------------------------------------

function renderPromptAppendix(turns: TurnRow[]): string {
  const uses = collectPromptUses(turns);
  const header = '## Prompt texts';
  if (uses.length === 0) {
    return [header, '', '_No Warden prompt recorded._'].join('\n');
  }
  const blocks: string[] = [header];
  for (const u of uses) {
    blocks.push('');
    blocks.push(`### \`${u.filename}\` (recorded hash \`${u.hash}\`)`);
    blocks.push('');
    const file = rereadPromptFile('mothership', u.filename);
    if (file === null) {
      blocks.push(renderPromptMissingWarning(u.filename, u.hash));
      continue;
    }
    if (file.hash !== u.hash) {
      blocks.push(renderPromptMismatchWarning(u.filename, u.hash, file.hash));
      blocks.push('');
    }
    blocks.push('```');
    blocks.push(file.text);
    blocks.push('```');
  }
  return blocks.join('\n');
}

function renderPromptMissingWarning(
  filename: string,
  recordedHash: string,
): string {
  return [
    `> ⚠️ **Prompt file missing.** \`${filename}\` was not found on disk at`,
    `> report-generation time. Telemetry recorded hash \`${recordedHash}\`.`,
    `> The text Claude actually saw for turns using this hash is no longer`,
    `> recoverable. Restore the file from git or regenerate this report from`,
    `> a checkout where the file exists.`,
  ].join('\n');
}

function renderPromptMismatchWarning(
  filename: string,
  recordedHash: string,
  currentHash: string,
): string {
  return [
    `> ⚠️ **Prompt hash mismatch.** Telemetry recorded hash \`${recordedHash}\``,
    `> for this filename, but the file on disk currently hashes to`,
    `> \`${currentHash}\`. The text below is the *current* file — the text`,
    `> Claude actually saw for turns using hash \`${recordedHash}\` is no`,
    `> longer recoverable. Regenerate this report from a checkout where the`,
    `> file matches the recorded hash if the original text is needed.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Low-level helpers.
// ---------------------------------------------------------------------------

function blockQuote(text: string): string {
  const lines = text.split('\n');
  return lines.map((l) => `> ${l}`).join('\n');
}

function indentBlockQuote(text: string, indent: string): string {
  const lines = text.split('\n');
  return lines.map((l) => `${indent}> ${l}`).join('\n');
}

function formatInt(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

function formatSignedInt(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatTimestamp(d: Date): string {
  // ISO 8601 without fractional seconds, UTC. Deterministic, snapshot-safe.
  const iso = d.toISOString();
  return iso.slice(0, 19) + 'Z';
}

// Re-export for tests that construct a synthetic WardenPromptRef.
export type { WardenPromptRef };
