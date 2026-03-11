<script lang="ts">
  import { signIn } from '$lib/auth'
  import { goto } from '$app/navigation'

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
      goto('/')
    }
  }
</script>

<h1>Sign in</h1>

<form onsubmit={handleSubmit}>
  <label>
    Email
    <input type="email" bind:value={email} required />
  </label>
  <label>
    Password
    <input type="password" bind:value={password} required />
  </label>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  <button type="submit">Sign in</button>
</form>
