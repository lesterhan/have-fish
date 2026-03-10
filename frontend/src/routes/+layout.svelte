<script lang="ts">
  let { children } = $props()
</script>

<nav>
  <a href="/">Dashboard</a>
  <a href="/accounts">Accounts</a>
  <a href="/transactions">Transactions</a>
</nav>

<main>
  {@render children()}
</main>
