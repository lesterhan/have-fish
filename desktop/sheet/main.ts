import { mount } from 'svelte'
import '../renderer/fonts.css'
import '../renderer/tokens.css'
import Sheet from './Sheet.svelte'

const target = document.getElementById('sheet')
if (target === null) throw new Error('index.html has no #sheet')
mount(Sheet, { target })
