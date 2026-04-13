<span class="dot" class:online={status === 'online'} class:offline={status === 'offline'}></span>

<script lang="ts">
  let {
    status = 'online',
  }: {
    status?: 'online' | 'offline';
  } = $props();
</script>

<style>
  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
  }

  .dot.online {
    background: var(--color-presence-online);
  }

  .dot.offline {
    background: var(--color-text-ghost);
  }
</style>
