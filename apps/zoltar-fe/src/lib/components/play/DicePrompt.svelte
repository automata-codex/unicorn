<script lang="ts">
  import {
    allFilled,
    buildInitialEntry,
    rollForMe,
    validateDieInput,
    type DicePromptEntry,
    type DicePromptRequest,
  } from './dice-prompt-helpers';

  type DiceMode = 'soft_accountability' | 'commitment';

  export interface DiceSubmission {
    requestId: string;
    notation: string;
    results: number[];
    source: 'player_entered' | 'system_generated';
  }

  let {
    requests,
    diceMode,
    onsubmit,
  }: {
    requests: DicePromptRequest[];
    diceMode: DiceMode;
    onsubmit: (results: DiceSubmission[]) => void | Promise<void>;
  } = $props();

  // Per-request UI state. `$derived` would recompute each time `requests`
  // changes, wiping unsaved inputs. Instead, rebuild explicitly when the
  // list of request ids shifts — keeps entries stable while the user types.
  // The init captures current `requests`; the $effect below handles later
  // changes. Svelte can't infer this pattern statically, hence the ignore.
  // svelte-ignore state_referenced_locally
  let entries: DicePromptEntry[] = $state(requests.map(buildInitialEntry));
  let signature = $derived(requests.map((r) => r.id).join('|'));
  // svelte-ignore state_referenced_locally
  let previousSignature = signature;
  $effect(() => {
    if (signature !== previousSignature) {
      entries = requests.map(buildInitialEntry);
      rawInputs = requests.map((r) => {
        const { count } = buildInitialEntry(r);
        return Array(count).fill('');
      });
      previousSignature = signature;
    }
  });

  let submitting = $state(false);

  // Raw string inputs, one per die across all requests. Parallel structure
  // to `entries.entries` — we hold strings so partial inputs like "" or "3"
  // (mid-typing) don't fight number coercion.
  // svelte-ignore state_referenced_locally
  let rawInputs: string[][] = $state(requests.map((r) => {
    const { count } = buildInitialEntry(r);
    return Array(count).fill('');
  }));

  function setDie(reqIdx: number, dieIdx: number, raw: string): void {
    rawInputs[reqIdx][dieIdx] = raw;
    const entry = entries[reqIdx];
    const result = validateDieInput(raw, entry.sides);
    entry.entries[dieIdx] = result.valid === true ? result.value : null;
    // When the user types manually after a "Roll for me", the source
    // changes back to player_entered — the submitted dice are theirs.
    entry.source = 'player_entered';
    entries = [...entries];
  }

  function rollRequest(reqIdx: number): void {
    const entry = entries[reqIdx];
    const results = rollForMe(entry.notation);
    entry.entries = results;
    entry.source = 'system_generated';
    rawInputs[reqIdx] = results.map(String);
    entries = [...entries];
    rawInputs = [...rawInputs];
  }

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (submitting || !allFilled(entries)) return;
    submitting = true;
    try {
      const payload: DiceSubmission[] = entries.map((e) => ({
        requestId: e.requestId,
        notation: e.notation,
        // Non-null here because allFilled() gated us through.
        results: e.entries.filter((v): v is number => v !== null),
        source: e.source,
      }));
      await onsubmit(payload);
    } finally {
      submitting = false;
    }
  }

  // Show target only in soft_accountability. Commitment mode hides it
  // until the GM reveals — docs/zoltar-design-doc.md § Dice Rolling Modes.
  function shouldShowTarget(target: number | null): boolean {
    return diceMode === 'soft_accountability' && target !== null;
  }

  let submitReady = $derived(allFilled(entries) && !submitting);
</script>

<section class="dice-prompt" aria-label="Dice rolls required">
  <header class="heading">
    <span class="label">ROLLS NEEDED</span>
    <span class="count">{requests.length}</span>
  </header>

  <form onsubmit={handleSubmit}>
    {#each requests as request, reqIdx (request.id)}
      {@const entry = entries[reqIdx]}
      <article class="card">
        <div class="purpose">{request.purpose}</div>
        <div class="notation-row">
          <span class="notation">Roll {request.notation}</span>
          {#if shouldShowTarget(request.target)}
            <span class="target">vs. target {request.target}</span>
          {/if}
        </div>

        <div class="dice-row">
          <button
            type="button"
            class="roll-btn"
            onclick={() => rollRequest(reqIdx)}
            disabled={submitting}
          >
            Roll for me
          </button>
          <div class="inputs" role="group" aria-label="Raw die faces">
            {#each Array.from({ length: entry.count }) as _, dieIdx (dieIdx)}
              {@const validation = validateDieInput(
                rawInputs[reqIdx][dieIdx],
                entry.sides,
              )}
              <input
                type="text"
                inputmode="numeric"
                class="die-input"
                class:invalid={validation.valid === false}
                class:system={entry.source === 'system_generated'}
                aria-label={`d${entry.sides} face ${dieIdx + 1}`}
                aria-invalid={validation.valid === false}
                value={rawInputs[reqIdx][dieIdx]}
                oninput={(e) =>
                  setDie(reqIdx, dieIdx, (e.target as HTMLInputElement).value)}
                readonly={entry.source === 'system_generated'}
                disabled={submitting}
              />
            {/each}
          </div>
        </div>

        <p class="hint">
          Enter the number showing on each die — modifiers applied
          automatically.
        </p>
      </article>
    {/each}

    <div class="footer">
      <button
        type="submit"
        class="submit"
        disabled={!submitReady}
        aria-disabled={!submitReady}
      >
        {submitting ? 'SUBMITTING…' : 'SUBMIT ROLLS'}
      </button>
    </div>
  </form>
</section>

<style>
  .dice-prompt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--color-roll-prompt-bg);
    border: 1px solid var(--color-roll-prompt-border);
    border-radius: var(--radius-md);
  }

  .heading {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .label {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-roll-prompt-label);
  }

  .count {
    font-family: var(--font-primary);
    font-size: var(--font-size-lg);
    color: var(--color-roll-prompt-label);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-roll-result-bg);
    border: 1px solid var(--color-roll-prompt-border);
    border-radius: var(--radius-sm);
  }

  .purpose {
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    color: var(--color-text-primary);
  }

  .notation-row {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
  }

  .notation {
    font-family: var(--font-primary);
    font-size: var(--font-size-md);
    color: var(--color-roll-prompt-label);
    letter-spacing: var(--tracking-base);
  }

  .target {
    font-family: var(--font-primary);
    font-size: var(--font-size-sm);
    color: var(--color-roll-prompt-text);
  }

  .dice-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }

  .roll-btn {
    font-family: var(--font-primary);
    font-size: var(--font-size-sm);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    background: var(--btn-primary-bg);
    color: var(--btn-primary-text);
    border: none;
    border-radius: var(--btn-primary-radius);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
  }

  .roll-btn:hover:not(:disabled) {
    background: var(--btn-primary-bg-hover);
  }

  .roll-btn:disabled {
    background: var(--btn-disabled-bg);
    color: var(--btn-disabled-text);
    cursor: not-allowed;
  }

  .inputs {
    display: flex;
    gap: var(--space-2);
  }

  .die-input {
    width: 3.5ch;
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    text-align: center;
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--color-roll-result-value);
    border-radius: var(--input-radius);
    padding: var(--space-2);
    outline: none;
  }

  .die-input:focus {
    border-color: var(--color-accent-border);
  }

  .die-input.invalid {
    border-color: var(--color-state-danger, var(--color-accent-border));
  }

  .die-input.system {
    background: var(--color-roll-result-bg);
    cursor: default;
  }

  .hint {
    margin: 0;
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-roll-prompt-text);
    font-style: italic;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--space-2);
  }

  .submit {
    font-family: var(--font-primary);
    font-size: var(--font-size-sm);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    background: var(--btn-primary-bg);
    color: var(--btn-primary-text);
    border: none;
    border-radius: var(--btn-primary-radius);
    padding: var(--space-2) var(--space-5);
    cursor: pointer;
  }

  .submit:hover:not(:disabled) {
    background: var(--btn-primary-bg-hover);
  }

  .submit:disabled {
    background: var(--btn-disabled-bg);
    color: var(--btn-disabled-text);
    cursor: not-allowed;
  }
</style>
