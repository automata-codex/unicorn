<script lang="ts">
  let {
    disabled = false,
    onsend,
  }: {
    disabled?: boolean;
    onsend: (content: string) => void;
  } = $props();

  let value = $state('');

  function submit(event: Event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onsend(trimmed);
    value = '';
  }
</script>

<form class="input-row" onsubmit={submit}>
  <input
    type="text"
    placeholder="What do you do?"
    bind:value
    {disabled}
    class="text"
    aria-label="Player input"
  />
  <button type="submit" class="send" disabled={disabled || value.trim().length === 0}>
    SEND
  </button>
</form>

<style>
  .input-row {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-4) 0;
    border-top: 1px solid var(--color-bar-track);
  }

  .text {
    flex: 1;
    font-family: var(--font-primary);
    font-size: var(--font-size-base);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--input-text);
    border-radius: var(--input-radius);
    padding: var(--input-padding);
    outline: none;
    min-width: 0;
  }

  .text::placeholder {
    color: var(--input-placeholder);
  }

  .text:focus {
    border-color: var(--color-accent-border);
  }

  .text:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .send {
    font-family: var(--font-primary);
    font-size: var(--font-size-sm);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    background: var(--btn-primary-bg);
    color: var(--btn-primary-text);
    border: none;
    border-radius: var(--btn-primary-radius);
    padding: 0 var(--space-5);
    cursor: pointer;
  }

  .send:hover:not(:disabled) {
    background: var(--btn-primary-bg-hover);
  }

  .send:disabled {
    background: var(--btn-disabled-bg);
    color: var(--btn-disabled-text);
    cursor: not-allowed;
  }
</style>
