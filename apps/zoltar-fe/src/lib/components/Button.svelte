<button
  class="btn {variant}"
  class:full-width={fullWidth}
  type={type}
  disabled={disabled}
  onclick={onclick}
>
  {@render children()}
</button>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'primary',
    disabled = false,
    type = 'button',
    fullWidth = false,
    onclick,
    children,
  }: {
    variant?: 'primary' | 'ghost';
    disabled?: boolean;
    type?: 'button' | 'submit';
    fullWidth?: boolean;
    onclick?: () => void;
    children: Snippet;
  } = $props();
</script>

<style>
  .btn {
    font-family: var(--font-primary);
    font-size: var(--font-size-md);
    letter-spacing: var(--tracking-base);
    text-transform: uppercase;
    padding: var(--space-4) var(--space-5);
    border: none;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .btn.full-width {
    width: 100%;
  }

  /* Primary variant */
  .btn.primary {
    background: var(--btn-primary-bg);
    color: var(--btn-primary-text);
    border-radius: var(--btn-primary-radius);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--btn-primary-bg-hover);
  }

  .btn.primary:active:not(:disabled) {
    transform: scale(0.98);
  }

  /* Ghost variant */
  .btn.ghost {
    background: transparent;
    color: var(--btn-ghost-text);
    border-radius: var(--btn-primary-radius);
  }

  .btn.ghost:hover:not(:disabled) {
    color: var(--btn-ghost-text-active);
  }

  .btn.ghost:active:not(:disabled) {
    transform: scale(0.98);
  }

  /* Disabled state — overrides both variants */
  .btn:disabled {
    background: var(--btn-disabled-bg);
    border: 1px solid var(--btn-disabled-border);
    color: var(--btn-disabled-text);
    cursor: not-allowed;
  }
</style>
