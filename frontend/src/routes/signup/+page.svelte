<script lang="ts">
  import { signUp } from '$lib/auth'
  import { goto } from '$app/navigation'
  import Button from '$lib/components/ui/Button.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'

  let email = $state('')
  let password = $state('')
  let confirmPassword = $state('')
  let error = $state('')

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    error = ''

    if (password !== confirmPassword) {
      error = 'Passwords do not match'
      return
    }

    // Better Auth requires a name field — use email as the display name since
    // we don't collect a separate name on sign-up.
    const result = await signUp.email({ email, password, name: email })
    if (result.error) {
      error = result.error.message ?? 'Sign up failed'
    } else {
      goto('/')
    }
  }
</script>

<div class="panel">
  <div class="panel-titlebar">
    <Icon name="create-user" />
    <span>Create account</span>
  </div>

  <div class="panel-body">
    <form onsubmit={handleSubmit}>
      <div class="field">
        <label for="email">Email</label><span class="label-hint"
          >(I will never email you)</span
        >
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
          autocomplete="new-password"
        />
      </div>

      <div class="field">
        <label for="confirm-password">Confirm password</label>
        <TextInput
          id="confirm-password"
          type="password"
          bind:value={confirmPassword}
          required
          autocomplete="new-password"
        />
      </div>

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        <GradientButton type="submit">Create account</GradientButton>
      </div>
    </form>

    <p class="switch-link">
      Already have an account? <a href="/login">Sign in</a>
    </p>
  </div>
</div>

<style>
  .panel {
    width: 280px;
    margin: var(--sp-2xl) auto 0;
    background: var(--color-window);
    box-shadow: var(--shadow-window);
    font-family: var(--font-serif);
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

  .label-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
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
    border-top: 1px solid var(--color-border);
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
