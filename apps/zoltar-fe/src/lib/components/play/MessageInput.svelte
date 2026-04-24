<script lang="ts">
  /**
   * Controlled narrative input. The parent owns `value` so it can be read
   * from other handlers (DicePrompt's submit path, for instance, needs to
   * know whether the player typed narrative alongside their rolls).
   *
   * `sendDisabled` gates only the SEND button, not the text field — while
   * dice are pending the field stays editable so the player can start
   * typing their reaction before rolling, but server-side the narrative
   * POST is rejected until rolls resolve, so hiding SEND enforces the
   * invariant client-side.
   */
  let {
    value = $bindable(''),
    sendDisabled = false,
    onsend,
  }: {
    value?: string;
    sendDisabled?: boolean;
    onsend: (content: string) => void;
  } = $props();

  function submit(event: Event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || sendDisabled) return;
    onsend(trimmed);
    value = '';
  }
</script>

<form class="input-row" onsubmit={submit}>
  <input
    type="text"
    placeholder="What do you do?"
    bind:value
    class="text"
    aria-label="Player input"
  />
  <button
    type="submit"
    class="send"
    disabled={sendDisabled || value.trim().length === 0}
  >
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
