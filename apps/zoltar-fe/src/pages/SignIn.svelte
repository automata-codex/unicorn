<script lang="ts">
  import { router } from 'svelte-spa-router';

  import { api } from '../lib/api';
  import Button from '../lib/components/Button.svelte';
  import Card from '../lib/components/Card.svelte';
  import Input from '../lib/components/Input.svelte';

  let email = $state('');
  let submitted = $state(false);
  let error = $state('');

  // Check for error from failed verify redirect. The querystring lives inside
  // the hash (e.g. `/#/signin?error=invalid_token`), so read it from the router.
  const params = new URLSearchParams(router.querystring ?? '');
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

<div class="signin-page">
  <span class="signin-wordmark">ZOLTAR</span>

  <Card>
    {#if submitted}
      <p class="type-meta confirmation">LINK TRANSMITTED — CHECK YOUR INBOX</p>
      <p class="type-meta dev-note">MAILHOG → LOCALHOST:8025</p>
    {:else}
      <h1 class="type-screen-label card-title">CREW ACCESS</h1>

      <form onsubmit={handleSubmit}>
        {#if error}
          <p class="error-text">{error}</p>
        {/if}

        <div class="form-field">
          <Input
            label="EMAIL"
            type="text"
            placeholder="user@domain"
            value={email}
            oninput={(e) => { email = (e.target as HTMLInputElement).value; }}
          />
        </div>

        <Button fullWidth type="submit">REQUEST ACCESS</Button>
      </form>
    {/if}
  </Card>
</div>

<style>
  .signin-page {
    min-height: 100vh;
    background: var(--color-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-7);
  }

  .signin-wordmark {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-accent);
    letter-spacing: var(--tracking-widest);
    text-transform: uppercase;
    margin-bottom: var(--space-7);
  }

  .signin-page :global(.card) {
    width: 100%;
  }

  @media (min-width: 768px) {
    .signin-page :global(.card) {
      max-width: 400px;
    }
  }

  .card-title {
    margin-bottom: var(--space-7);
  }

  .form-field {
    margin-bottom: var(--space-5);
  }

  .error-text {
    font-family: var(--font-primary);
    font-size: var(--font-size-xs);
    color: var(--color-danger);
    margin-bottom: var(--space-4);
  }

  .confirmation {
    text-align: center;
    margin-bottom: var(--space-5);
  }

  .dev-note {
    text-align: center;
    color: var(--color-text-ghost);
  }
</style>
