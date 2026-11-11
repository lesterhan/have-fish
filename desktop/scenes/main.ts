// The window in a browser tab: with ?scene=<name>, sets the clock and the stand-in bridge, then
// runs the window's own main. With no scene named, a link to each.

import { replayBridge } from './bridge'
import { EMPTY, type Fixture, noonOf } from './fixture'
import { type Scene, SCENES, sceneNamed } from './scenes'
import { run } from './steps'

const scene = sceneNamed(new URLSearchParams(location.search).get('scene'))

if (scene === null) index()
else await show(scene)

/** The list of scenes, each a link to itself. */
function index() {
  const app = document.getElementById('app')
  if (app === null) throw new Error('index.html has no #app')
  const list = document.createElement('ul')
  for (const scene of SCENES) {
    const link = document.createElement('a')
    link.href = `?scene=${scene.name}`
    link.textContent = scene.name
    const item = document.createElement('li')
    item.append(link)
    list.append(item)
  }
  app.replaceChildren(list)
}

/** The window over `scene`'s fixture, as if main had answered it; the window can't tell. */
async function show(scene: Scene) {
  const fixture =
    scene.fixture === 'empty'
      ? EMPTY
      : ((await import(`./fixtures/${scene.fixture}.json`)) as { default: Fixture }).default
  // The window reads the time only through Date.now, via todayIn: it is always noon of the
  // fixture's last day, so a shot doesn't move with the calendar.
  Date.now = () => noonOf(fixture.today)
  const bridge = replayBridge(fixture, { density: scene.density })
  window.haveFish = bridge
  await import('../renderer/main')
  await run(scene.steps, bridge)
}
