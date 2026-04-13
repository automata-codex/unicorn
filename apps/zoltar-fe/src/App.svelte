<script lang="ts">
  import { onMount } from 'svelte';

  import { api } from './lib/api';
  import { navigate, route } from './lib/router.svelte';
  import { loadSession, session, sessionLoading } from './lib/session.svelte';
  import CampaignDetail from './pages/CampaignDetail.svelte';
  import CampaignList from './pages/CampaignList.svelte';
  import DevComponents from './pages/DevComponents.svelte';
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

  async function handleSignOut() {
    await api('/api/v1/auth/signout', { method: 'POST' });
    session.set(null);
    navigate('/signin');
  }

  // Extract campaignId from /campaigns/:id paths
  function getCampaignId(path: string): string | null {
    const match = path.match(/^\/campaigns\/([^/]+)/);
    return match ? match[1] : null;
  }
</script>

{#if $sessionLoading}
  <p>Loading...</p>
{:else}
  {#if $session}
    <nav>
      <span>{$session.email}</span>
      <button onclick={handleSignOut}>Sign out</button>
    </nav>
  {/if}

  {#if $route.startsWith('/dev/components')}
    <DevComponents />
  {:else if $route.startsWith('/signin')}
    <SignIn />
  {:else if getCampaignId($route)}
    <CampaignDetail campaignId={getCampaignId($route)!} />
  {:else if $route === '/campaigns' || $route === '/'}
    <CampaignList />
  {:else}
    <p>Not found</p>
  {/if}
{/if}
