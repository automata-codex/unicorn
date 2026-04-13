<script lang="ts">
	import { api } from '../lib/api';

	let email = $state('');
	let submitted = $state(false);
	let error = $state('');

	// Check for error from failed verify redirect
	const params = new URLSearchParams(window.location.search);
	if (params.get('error') === 'invalid_token') {
		error = 'That link is invalid or expired. Please request a new one.';
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';

		const res = await api('/api/v1/auth/magic-link', {
			method: 'POST',
			body: JSON.stringify({ email }),
		});

		if (res.ok) {
			submitted = true;
		} else {
			error = 'Something went wrong. Please try again.';
		}
	}
</script>

<main>
	<h1>Sign in to Zoltar</h1>

	{#if submitted}
		<p>Check your email for a sign-in link.</p>
		<p><small>Local dev: check MailHog at <a href="http://localhost:8025">http://localhost:8025</a></small></p>
	{:else}
		<form onsubmit={handleSubmit}>
			{#if error}
				<p style="color: red">{error}</p>
			{/if}
			<label>
				Email
				<input type="email" bind:value={email} required />
			</label>
			<button type="submit">Send magic link</button>
		</form>
	{/if}
</main>
