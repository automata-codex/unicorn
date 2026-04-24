<script lang="ts">
  import DiceRollBubble from './DiceRollBubble.svelte';
  import MessageBubble from './MessageBubble.svelte';

  import type { TimelineEntry } from './timeline';

  let {
    timeline,
    typing = false,
  }: { timeline: TimelineEntry[]; typing?: boolean } = $props();

  let scrollEl: HTMLDivElement | undefined = $state();

  // Auto-scroll to bottom whenever the timeline or typing state changes.
  $effect(() => {
    // Read the signals we want to track.
    const _len = timeline.length;
    const _typing = typing;
    // Acknowledge reads so the linter doesn't flag them; $effect uses them.
    void _len;
    void _typing;
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });
</script>

<div bind:this={scrollEl} class="log">
  {#each timeline as entry (entry.id)}
    {#if entry.type === 'message'}
      <MessageBubble role={entry.role} content={entry.content} />
    {:else}
      <DiceRollBubble
        purpose={entry.purpose}
        notation={entry.notation}
        results={entry.results}
        total={entry.total}
        target={entry.target}
        source={entry.source}
      />
    {/if}
  {/each}
  {#if typing}
    <div class="typing" aria-label="Warden is thinking">
      <span></span>
    </div>
  {/if}
</div>

<style>
  .log {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4) 0;
  }

  .typing {
    display: flex;
    padding-left: var(--space-2);
    padding-bottom: var(--space-4);
  }

  .typing span {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--color-text-ghost);
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }
</style>
