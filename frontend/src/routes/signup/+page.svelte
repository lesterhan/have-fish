<script lang="ts">
  import { signUp } from '$lib/auth'
  import { copy } from '$lib/copy'
  import { goto } from '$app/navigation'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'

  let email = $state('')
  let name = $state('')
  let password = $state('')
  let confirmPassword = $state('')
  let error = $state('')

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    error = ''

    if (password !== confirmPassword) {
      error = copy.auth.signUp.passwordMismatch
      return
    }

    const result = await signUp.email({ email, password, name: name.trim() || email })
    if (result.error) {
      error = result.error.message ?? copy.auth.signUp.failed
    } else {
      goto('/')
    }
  }
</script>

<div class="panel">
  <div class="panel-titlebar">
    <Icon name="create-user" />
    <span>{copy.auth.signUp.title}</span>
  </div>

  <div class="panel-body">
    <form onsubmit={handleSubmit}>
      <div class="field">
        <label for="email">{copy.auth.signUp.email}</label><span
          class="label-hint">{copy.auth.signUp.emailHint}</span
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
        <label for="name">{copy.auth.signUp.name}</label><span
          class="label-hint">{copy.auth.signUp.nameHint}</span
        >
        <TextInput
          id="name"
          bind:value={name}
          autocomplete="name"
          placeholder={copy.auth.signUp.namePlaceholder}
        />
      </div>

      <div class="field">
        <label for="password">{copy.auth.signUp.password}</label>
        <TextInput
          id="password"
          type="password"
          bind:value={password}
          required
          autocomplete="new-password"
        />
      </div>

      <div class="field">
        <label for="confirm-password">{copy.auth.signUp.confirmPassword}</label>
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
        <GradientButton type="submit">{copy.auth.signUp.submit}</GradientButton>
      </div>
    </form>

    <p class="switch-link">
      {copy.auth.signUp.switch.question}
      <a href="/login">{copy.auth.signUp.switch.action}</a>
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
