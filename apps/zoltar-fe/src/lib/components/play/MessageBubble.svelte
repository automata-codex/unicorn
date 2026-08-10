<script lang="ts">
  let {
    role,
    content,
    turnNumber = null,
  }: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    /**
     * Turn ordinal for the playtest-note workflow. `null` renders no marker
     * at all rather than a placeholder — an unlabelled bubble is the honest
     * rendering of "not attached to a completed turn".
     */
    turnNumber?: number | null;
  } = $props();
</script>

<div class="bubble" class:user={role === 'user'} class:assistant={role === 'assistant'} class:system={role === 'system'}>
  {#if turnNumber !== null}
    <div class="turn-marker">Turn {turnNumber}</div>
  {/if}
  <p>{content}</p>
</div>

<style>
  .bubble {
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    line-height: 1.5;
    margin-bottom: var(--space-4);
  }

  .bubble p {
    margin: 0;
    white-space: pre-wrap;
  }

  /* Same recipe as SectionLabel (the `--label-*` component tokens, uppercase),
     because this is the same thing visually: a small tracked metadata label.
     Not the component itself — the marker has to inherit the bubble's
     alignment, and it isn't a section header. */
  .turn-marker {
    font-family: var(--font-primary);
    font-size: var(--label-size);
    color: var(--label-text);
    letter-spacing: var(--label-tracking);
    text-transform: uppercase;
    margin-bottom: var(--space-1);
  }

  .bubble.user {
    color: var(--color-text-tertiary);
    text-align: right;
    padding-left: var(--space-8);
  }

  .bubble.assistant {
    color: var(--color-text-primary);
    padding-right: var(--space-4);
  }

  .bubble.system {
    color: var(--color-text-ghost);
    font-size: var(--font-size-sm);
    font-style: italic;
  }
</style>
