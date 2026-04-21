<script lang="ts">
  import MessageBubble from './MessageBubble.svelte';

  export interface LogMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
  }

  let {
    messages,
    typing = false,
  }: { messages: LogMessage[]; typing?: boolean } = $props();

  let scrollEl: HTMLDivElement | undefined = $state();

  // Auto-scroll to bottom whenever the message list or typing state changes.
  $effect(() => {
    // Read the signals we want to track.
    const _len = messages.length;
    const _typing = typing;
    // Acknowledge reads so the linter doesn't flag them; $effect uses them.
    void _len;
    void _typing;
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });
</script>

<div bind:this={scrollEl} class="log">
  {#each messages as msg (msg.id)}
    <MessageBubble role={msg.role} content={msg.content} />
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
