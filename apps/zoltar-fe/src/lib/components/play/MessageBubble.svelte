<script lang="ts">
  let {
    role,
    content,
  }: {
    role: 'user' | 'assistant' | 'system';
    content: string;
  } = $props();
</script>

<div class="bubble" class:user={role === 'user'} class:assistant={role === 'assistant'} class:system={role === 'system'}>
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
