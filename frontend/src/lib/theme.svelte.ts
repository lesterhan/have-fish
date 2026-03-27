import { browser } from '$app/environment'

// Rune-based theme store. Use theme.dark to read, theme.toggle() to switch.
// Persists to localStorage and syncs data-theme on <html>.
function createTheme() {
  let dark = $state(browser ? localStorage.getItem('theme') === 'dark' : false)

  $effect.root(() => {
    $effect(() => {
      if (!browser) return
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      localStorage.setItem('theme', dark ? 'dark' : 'light')
    })
  })

  return {
    get dark() { return dark },
    toggle() { dark = !dark },
  }
}

export const theme = createTheme()
