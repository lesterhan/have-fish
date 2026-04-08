<script lang="ts">
  import { signUp } from '$lib/auth'
  import { goto } from '$app/navigation'
  import Button from '$lib/components/ui/Button.svelte'

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
    <span class="panel-icon">🪪</span>
    <span>Create account</span>
  </div>

  <div class="panel-body">
    <form onsubmit={handleSubmit}>
      <div class="field">
        <label for="email">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          required
          autocomplete="email"
        />
      </div>

      <div class="field">
        <label for="password">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          required
          autocomplete="new-password"
        />
      </div>

      <div class="field">
        <label for="confirm-password">Confirm password</label>
        <input
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
        <Button type="submit" variant="primary">Create account</Button>
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
  }

  .panel-titlebar {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: 3px var(--sp-xs);
    background: linear-gradient(
      to right,
      var(--color-titlebar-from),
      var(--color-titlebar-to)
    );
    color: var(--color-titlebar-text);
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

  input {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 3px var(--sp-xs);
    height: 22px;
    width: 100%;
    box-sizing: border-box;
    outline: none;
    transition: outline var(--duration-fast) var(--ease);
  }

  input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
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
    border-top: 1px solid var(--color-bevel-dark);
    margin-top: var(--sp-sm);
  }

  .switch-link {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    text-align: center;
    margin-top: var(--sp-md);
    margin-bottom: 0;
  }

  .switch-link a {
    color: var(--color-accent-mid);
  }
</style>
