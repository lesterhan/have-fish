import { mount } from 'svelte'
import App from './App.svelte'
import { showDensity } from './density'
import './fonts.css'
import './tokens.css'

const target = document.getElementById('app')
if (target === null) throw new Error('index.html has no #app')

// Shown before the first frame: the lists measure the density they are already laid out in.
const kept = await window.haveFish.invoke('settings.density.get', {})
if (kept.ok) showDensity(kept.value.density)

mount(App, { target })
