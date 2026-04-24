<script lang="ts">
  /**
   * One rendered `dice_roll` event in the message log. Fed from the
   * backend's `game_events` stream (plus — for player-entered rolls — the
   * `dice_request` the FE already has locally, which carries `target`).
   * Visually distinct from player/GM bubbles: monospaced, muted, left-
   * aligned regardless of source — mechanical events aren't character turns.
   */
  let {
    purpose,
    notation,
    results,
    total,
    target = null,
    source,
  }: {
    purpose: string;
    notation: string;
    results: number[];
    total: number;
    target?: number | null;
    source: 'system_generated' | 'player_entered';
  } = $props();

  let outcome = $derived(
    target === null ? null : total <= target ? 'success' : 'failure',
  );

  let indicator = $derived(source === 'system_generated' ? 'GM' : 'YOU');
</script>

<div class="bubble" class:success={outcome === 'success'} class:failure={outcome === 'failure'}>
  <div class="header-row">
    <span class="indicator" aria-label={`Rolled by ${indicator === 'GM' ? 'the Warden' : 'you'}`}>
      ● {indicator}
    </span>
    <span class="purpose">{purpose}</span>
  </div>
  <div class="result-row">
    <span class="notation">{notation}</span>
    <span class="arrow">→</span>
    <span class="dice" aria-label="Individual die results">
      [{results.join(', ')}]
    </span>
    <span class="total">total {total}</span>
    {#if target !== null}
      <span class="outcome">target {target}, {outcome}</span>
    {/if}
  </div>
</div>

<style>
  .bubble {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-roll-result-bg);
    border-left: 2px solid var(--color-roll-result-border);
    font-family: var(--font-primary);
    font-size: var(--font-size-sm);
  }

  .bubble.success {
    border-left-color: var(--color-state-success, var(--color-roll-result-border));
  }

  .bubble.failure {
    border-left-color: var(--color-state-danger, var(--color-roll-result-border));
  }

  .header-row {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
  }

  .indicator {
    font-size: var(--font-size-xs);
    letter-spacing: var(--tracking-wide);
    color: var(--color-roll-prompt-label);
  }

  .purpose {
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
  }

  .result-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    color: var(--color-roll-prompt-text);
  }

  .notation {
    color: var(--color-roll-prompt-label);
    letter-spacing: var(--tracking-base);
  }

  .arrow {
    color: var(--color-text-ghost, var(--color-roll-prompt-text));
  }

  .dice {
    color: var(--color-roll-result-value);
  }

  .total {
    color: var(--color-roll-result-value);
    letter-spacing: var(--tracking-base);
  }

  .outcome {
    color: var(--color-text-tertiary);
    font-style: italic;
  }
</style>
