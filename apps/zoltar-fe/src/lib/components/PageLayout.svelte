<div class="page-layout">
  <slot />
</div>

<style>
  .page-layout {
    min-height: 100vh;
    background: var(--color-bg);
    padding: var(--space-7);
  }

  @media (min-width: 768px) {
    .page-layout {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .page-layout :global(> *) {
      width: 100%;
      max-width: 680px;
    }
  }
</style>
