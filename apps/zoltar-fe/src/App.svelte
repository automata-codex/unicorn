<script lang="ts">
  import { onMount } from 'svelte';

  import { api } from './lib/api';
  import Button from './lib/components/Button.svelte';
  import { builtInOracleCategories } from './lib/data/oracle';
  import { navigate, route } from './lib/router.svelte';
  import { loadSession, session, sessionLoading } from './lib/session.svelte';
  import AdventureSynthesis from './pages/AdventureSynthesis.svelte';
  import CampaignDetail from './pages/CampaignDetail.svelte';
  import CampaignList from './pages/CampaignList.svelte';
  import CharacterCreate from './pages/CharacterCreate.svelte';
  import DevComponents from './pages/DevComponents.svelte';
  import OracleFilter from './pages/OracleFilter.svelte';
  import SignIn from './pages/SignIn.svelte';

  onMount(() => {
    loadSession();
  });

  // Redirect unauthenticated users to /signin after session load completes
  $effect(() => {
    if (!$sessionLoading && !$session && !$route.startsWith('/signin')) {
      navigate('/signin');
    }
  });

  // Redirect authenticated users away from /signin
  $effect(() => {
    if (!$sessionLoading && $session && $route.startsWith('/signin')) {
      navigate('/');
    }
  });

  async function handleSignOut() {
    await api('/api/v1/auth/signout', { method: 'POST' });
    session.set(null);
    navigate('/signin');
  }

  // Extract campaignId from /campaigns/:id paths
  function getCampaignId(path: string): string | null {
    const match = path.match(/^\/campaigns\/([^/]+)$/);
    return match ? match[1] : null;
  }

  // Extract campaignId from /campaigns/:id/characters/new
  function getCharacterCreateCampaignId(path: string): string | null {
    const match = path.match(/^\/campaigns\/([^/]+)\/characters\/new$/);
    return match ? match[1] : null;
  }

  // Extract campaignId from /campaigns/:id/oracle
  function getOracleCampaignId(path: string): string | null {
    const match = path.match(/^\/campaigns\/([^/]+)\/oracle$/);
    return match ? match[1] : null;
  }

  // Extract campaignId + adventureId from /campaigns/:id/adventures/:id
  function getAdventureIds(
    path: string,
  ): { campaignId: string; adventureId: string } | null {
    const match = path.match(/^\/campaigns\/([^/]+)\/adventures\/([^/]+)$/);
    return match ? { campaignId: match[1], adventureId: match[2] } : null;
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
        <span class="wordmark">ZOLTAR</span>
        <div class="nav-right">
          <span class="nav-email">{$session.email}</span>
          <Button variant="ghost" onclick={handleSignOut}>Sign out</Button>
        </div>
      </div>
    </nav>
  {/if}

  {#if $route.startsWith('/dev/components')}
    <DevComponents />
  {:else if $route.startsWith('/signin')}
    <SignIn />
  {:else if getOracleCampaignId($route)}
    <OracleFilter categories={builtInOracleCategories} campaignId={getOracleCampaignId($route)!} />
  {:else if getAdventureIds($route)}
    {@const ids = getAdventureIds($route)!}
    <AdventureSynthesis campaignId={ids.campaignId} adventureId={ids.adventureId} />
  {:else if getCharacterCreateCampaignId($route)}
    <CharacterCreate campaignId={getCharacterCreateCampaignId($route)!} />
  {:else if getCampaignId($route)}
    <CampaignDetail campaignId={getCampaignId($route)!} />
  {:else if $route === '/campaigns' || $route === '/'}
    <CampaignList />
  {:else}
    <p>Not found</p>
  {/if}
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
    color: var(--color-text-ghost);
  }
</style>
