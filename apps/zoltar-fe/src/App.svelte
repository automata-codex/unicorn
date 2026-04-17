<script lang="ts">
  import { onMount } from 'svelte';
  import Router, { push, router } from 'svelte-spa-router';

  import { api } from './lib/api';
  import Button from './lib/components/Button.svelte';
  import { loadSession, session, sessionLoading } from './lib/session.svelte';
  import routes from './routes';

  onMount(() => {
    loadSession();
  });

  // Redirect unauthenticated users to /signin after session load completes
  $effect(() => {
    if (
      !$sessionLoading &&
      !$session &&
      !router.location.startsWith('/signin')
    ) {
      push('/signin');
    }
  });

  // Redirect authenticated users away from /signin
  $effect(() => {
    if (!$sessionLoading && $session && router.location.startsWith('/signin')) {
      push('/');
    }
  });

  async function handleSignOut() {
    await api('/api/v1/auth/signout', { method: 'POST' });
    session.set(null);
    push('/signin');
  }
</script>

{#if $sessionLoading}
  <div class="loading-screen">
    <span class="loading-text">LOADING</span>
  </div>
{:else}
  {#if $session}
    <nav class="nav-bar">
      <div class="nav-inner">
        <button type="button" class="wordmark" onclick={() => push('/')}>ZOLTAR</button>
        <div class="nav-right">
          <span class="nav-email">{$session.email}</span>
          <Button variant="ghost" onclick={handleSignOut}>Sign out</Button>
        </div>
      </div>
    </nav>
  {/if}

  <Router {routes} />
{/if}

<style>
  .loading-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg);
  }

  .loading-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-text-ghost);
    letter-spacing: var(--tracking-widest);
  }

  .nav-bar {
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border-subtle);
    padding: var(--space-4) var(--space-7);
  }

  .nav-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  @media (min-width: 768px) {
    .nav-inner {
      max-width: 680px;
      margin: 0 auto;
    }
  }

  .wordmark {
    all: unset;
    cursor: pointer;
    font-family: var(--font-primary);
    font-size: var(--font-size-xl);
    color: var(--color-accent);
    letter-spacing: var(--tracking-widest);
    text-transform: uppercase;
  }

  .nav-right {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .nav-email {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-text-tertiary);
  }
</style>
