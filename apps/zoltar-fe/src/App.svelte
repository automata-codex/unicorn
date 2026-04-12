<script lang="ts">
	import { onMount } from 'svelte';
	import { session, sessionLoading, loadSession } from './lib/session.svelte';
	import { route, navigate } from './lib/router.svelte';

	onMount(() => {
		loadSession();
	});

	// Redirect unauthenticated users to /signin after session load completes
	$effect(() => {
		if (!$sessionLoading && !$session && !$route.startsWith('/signin')) {
			navigate('/signin');
		}
	});
</script>

{#if $sessionLoading}
	<p>Loading...</p>
{:else if $route.startsWith('/signin')}
	<p>Sign-in page placeholder</p>
{:else if $route.startsWith('/campaigns/')}
	<p>Campaign detail placeholder</p>
{:else if $route === '/campaigns'}
	<p>Campaign list placeholder</p>
{:else}
	<p>Not found</p>
{/if}
