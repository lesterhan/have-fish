<script lang="ts">
  import '../styles/tokens.css'
  import '../styles/base.css'
  import { signOut, useSession } from '$lib/auth'
  import { goto } from '$app/navigation'

  let { children } = $props()

  const session = useSession()

  async function handleSignOut() {
    await signOut()
    goto('/login')
  }
</script>

<nav>
  <a href="/">Dashboard</a>
  <a href="/accounts">Accounts</a>
  <a href="/transactions">Transactions</a>
  <a href="/import">Import</a>
  <a href="/settings">Settings</a>
  <span class="spacer"></span>
  {#if $session.data}
    <span>{$session.data.user.email}</span>
    <button onclick={handleSignOut}>Sign out</button>
  {:else}
    <a href="/login">Sign in</a>
  {/if}
</nav>

<main>
  {@render children()}
</main>
