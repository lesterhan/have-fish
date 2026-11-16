// The window in a browser tab: with ?scene=<name>, sets the clock and the stand-in bridge, then
// runs the window's own main. A density= sets the density over the scene's own, for the design
// bench. With no scene named, the index: a card for each.

import { replayBridge } from './bridge'
import { densityFor } from './controls'
import { EMPTY, type Fixture, noonOf } from './fixture'
import { type Scene, sceneNamed } from './scenes'
import { play } from './steps'

const asked = new URLSearchParams(location.search)
const scene = sceneNamed(asked.get('scene'))

if (scene === null) await index()
else await show(scene, asked.get('density'))

/** The index, loaded only here so a scene's page carries none of it. */
async function index() {
  const app = document.getElementById('app')
  if (app === null) throw new Error('index.html has no #app')
  const { drawIndex } = await import('./index-page')
  drawIndex(app)
}

/** The window over `scene`'s fixture, as if main had answered it; the window can't tell. */
async function show(scene: Scene, density: string | null) {
  const fixture =
    scene.fixture === 'empty'
      ? EMPTY
      : ((await import(`./fixtures/${scene.fixture}.json`)) as { default: Fixture }).default
  // The window reads the time only through Date.now, via todayIn: it is always noon of the
  // fixture's last day, so a shot doesn't move with the calendar.
  Date.now = () => noonOf(fixture.today)
  const bridge = replayBridge(fixture, { density: densityFor(scene, density) })
  window.haveFish = bridge
  await import('../renderer/main')
  // A shot waits for the mark play sets, never for a timer.
  await play(scene.steps, bridge)
}
