<script lang="ts">
  import { signIn } from '$lib/auth'
  import { goto } from '$app/navigation'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'

  let email = $state('')
  let password = $state('')
  let error = $state('')

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    error = ''
    const result = await signIn.email({ email, password })
    if (result.error) {
      error = result.error.message ?? 'Sign in failed'
    } else {
      goto('/spending')
    }
  }
</script>

<div class="panel">
  <div class="panel-titlebar">
    <span class="panel-icon">🔑</span>
    <span>Sign in</span>
  </div>

  <div class="panel-body">
    <form onsubmit={handleSubmit}>
      <div class="field">
        <label for="email">Email</label>
        <TextInput
          id="email"
          type="email"
          bind:value={email}
          required
          autocomplete="email"
        />
      </div>

      <div class="field">
        <label for="password">Password</label>
        <TextInput
          id="password"
          type="password"
          bind:value={password}
          required
          autocomplete="current-password"
        />
      </div>

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        <GradientButton type="submit">Sign in</GradientButton>
      </div>
    </form>

    <p class="switch-link">
      Don't have an account? <a href="/signup">Sign up</a>
    </p>
  </div>
</div>

<style>
  .panel {
    font-family: var(--font-serif);
    width: 280px;
    margin: var(--sp-2xl) auto 0;
    background: var(--color-window);
    box-shadow: var(--shadow-window);
  }

  .panel-titlebar {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: 3px var(--sp-xs);
    background: var(--color-titlebar-bg);
    color: var(--color-titlebar-fg);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    user-select: none;
  }

  .panel-icon {
    font-size: var(--text-sm);
  }

  .panel-body {
    padding: var(--sp-lg);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: var(--sp-md);
  }

  label {
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .error {
    font-size: var(--text-sm);
    color: var(--color-danger);
    margin-bottom: var(--sp-md);
    padding: var(--sp-xs);
    background: var(--color-danger-light);
    box-shadow: var(--shadow-sunken);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--sp-xs);
    margin-top: var(--sp-sm);
  }

  .switch-link {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-align: center;
    margin-top: var(--sp-md);
    margin-bottom: 0;
  }

  .switch-link a {
    color: var(--color-accent-mid);
  }
</style>
