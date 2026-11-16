// The scenes' index: a card for each scene, by place, in the window's own type and colours. Each
// card's one scene link has the scene's name as its whole text, as scenes:shots and the e2e read
// it. The bench links show only under scenes:dev, the one thing that serves the bench.

import '../renderer/fonts.css'
import '../renderer/tokens.css'
import './index-page.css'
import { type Scene, scenesByPlace } from './scenes'

const BENCH = import.meta.env.DEV

/** Draws the index into `app`. */
export function drawIndex(app: HTMLElement) {
  const places = scenesByPlace().filter((group) => group.scenes.length > 0)
  app.replaceChildren(
    header(),
    ...places.map(({ place, scenes }) =>
      el('section', { 'aria-labelledby': `place-${place}`, 'data-place': place }, [
        el('h2', { id: `place-${place}` }, [
          place,
          el('span', { class: 'count' }, [String(scenes.length)]),
        ]),
        el('ul', {}, scenes.map(card)),
      ]),
    ),
    footer(),
  )
}

function header(): HTMLElement {
  const count = scenesByPlace().reduce((sum, group) => sum + group.scenes.length, 0)
  return el('header', {}, [
    el('div', {}, [
      el('p', { class: 'kicker' }, ['有鱼 have-fish']),
      el('h1', {}, ['Scenes']),
      el('p', { class: 'lede' }, [
        `The real window over a recorded fixture, in ${count} named states. No Electron behind it.`,
      ]),
    ]),
    BENCH
      ? el('a', { class: 'bench', href: './bench.html' }, ['Open the design bench'])
      : el('p', { class: 'hint' }, ['The design bench runs under ', code('bun run scenes:dev')]),
  ])
}

function card(scene: Scene): HTMLElement {
  const [place, state] = scene.name.split('/')
  const tags = [
    `${scene.fixture} fixture`,
    ...(scene.density === undefined ? [] : [scene.density]),
    scene.steps.length === 0
      ? 'as it opens'
      : `${scene.steps.length} step${scene.steps.length === 1 ? '' : 's'}`,
  ]
  return el('li', {}, [
    el('a', { class: 'scene', href: `?${new URLSearchParams({ scene: scene.name })}` }, [
      el('span', { class: 'place' }, [`${place}/`]),
      el('span', { class: 'state' }, [state ?? '']),
    ]),
    el('p', { class: 'about' }, [scene.about]),
    el('div', { class: 'foot' }, [
      el(
        'ul',
        { class: 'tags', 'aria-label': 'Made from' },
        tags.map((tag) => el('li', {}, [tag])),
      ),
      ...(BENCH
        ? [
            el(
              'a',
              {
                class: 'to-bench',
                href: `./bench.html?${new URLSearchParams({ scene: scene.name })}`,
                'aria-label': `${scene.name} on the bench`,
              },
              ['Bench ↗'],
            ),
          ]
        : []),
    ]),
  ])
}

function footer(): HTMLElement {
  return el('footer', {}, [
    el('p', {}, [
      'Every scene at three sizes, light and dark: ',
      code('bun run scenes:shots'),
      '. What a branch moved: ',
      code('bun run scenes:diff main'),
      '.',
    ]),
  ])
}

const code = (text: string) => el('code', {}, [text])

/** An element with these attributes and children; text goes in as text, never as markup. */
function el(
  tag: string,
  attributes: Record<string, string>,
  children: readonly (Node | string)[],
): HTMLElement {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  element.append(...children)
  return element
}
