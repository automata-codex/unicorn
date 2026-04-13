<div class="resource-bar">
  <div class="header">
    <span class="label">{label}</span>
    <span class="value" class:hp={color === 'hp'} class:stress={color === 'stress'}>
      {current}/{max}
    </span>
  </div>
  <div class="track">
    <div class="fill" class:hp={color === 'hp'} class:stress={color === 'stress'} style="width: {fillPercent}%"></div>
  </div>
</div>

<script lang="ts">
  let {
    label,
    current,
    max,
    color = 'hp',
  }: {
    label: string;
    current: number;
    max: number;
    color?: 'hp' | 'stress';
  } = $props();

  let fillPercent = $derived(Math.min(100, Math.max(0, (current / max) * 100)));
</script>

<style>
  .resource-bar {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .label {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-text-ghost);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  .value {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
  }

  .value.hp {
    color: var(--color-hp);
  }

  .value.stress {
    color: var(--color-stress);
  }

  .track {
    height: 3px;
    background: var(--color-bar-track);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width 0.2s ease;
  }

  .fill.hp {
    background: var(--color-hp);
  }

  .fill.stress {
    background: var(--color-stress);
  }
</style>
