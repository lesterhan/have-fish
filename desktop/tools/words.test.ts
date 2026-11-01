import { describe, expect, test } from 'vitest'
import { isWords, wordsInSvelte, wordsInTs } from './words'

const inSvelte = (source: string) => wordsInSvelte(source).map((w) => w.text)
const inTs = (source: string) => wordsInTs(source).map((w) => w.text)

describe('isWords', () => {
  test.each(['Save', 'Write it down', "That isn't an amount.", 'ms ok', '保存 する'])(
    '%j is words',
    (text) => {
      expect(isWords(text)).toBe(true)
    },
  )

  test.each([
    '',
    '   ',
    '4.50',
    '●',
    'ArrowDown',
    'Enter',
    'Escape',
    'spend.write',
    'assets:cash',
    'ledger:changed',
    'CAD',
    'UNEXPECTED',
    '[role=option]',
    '../copy',
    'app://have-fish/',
    'nearest',
    'aria-invalid',
    // Lowercase single words are wiring, and the name is one: the markup check is the strict one.
    'have-fish',
    // CSS handed over from code: a media query, a declaration.
    '(max-width: 44rem)',
    'position: fixed;',
  ])('%j is not', (text) => {
    expect(isWords(text)).toBe(false)
  })
})

describe('wordsInSvelte: markup', () => {
  test('a text node with a letter in it is a hardcoded word, whatever it says', () => {
    expect(inSvelte('<p>Save</p>')).toEqual(['Save'])
    expect(inSvelte('<p>unsaved</p>')).toEqual(['unsaved'])
    expect(inSvelte('<p>保存</p>')).toEqual(['保存'])
  })

  test('text beside an interpolation is still hardcoded', () => {
    expect(inSvelte('<p>Total: {total}</p>')).toEqual(['Total:'])
  })

  test('interpolations, symbols and whitespace are not', () => {
    expect(inSvelte('<p>{copy.spends.pane.save}</p>\n<span>●</span> <b> </b>')).toEqual([])
  })

  test('inside blocks too', () => {
    expect(
      inSvelte('{#if a}<p>Yes</p>{:else}<p>No</p>{/if}{#each xs as x}<i>Item</i>{/each}'),
    ).toEqual(['Yes', 'No', 'Item'])
  })

  test('a literal on an attribute a person reads or hears', () => {
    expect(
      inSvelte('<input aria-label="Amount" title="The amount" placeholder="4.50" alt="x" />'),
    ).toEqual(['aria-label="Amount"', 'title="The amount"', 'alt="x"'])
  })

  test('an interpolated attribute is clean, and one with words around it is not', () => {
    expect(inSvelte('<input aria-label={label} title="{title}" />')).toEqual([])
    expect(inSvelte('<input aria-label="Total {n}" />')).toEqual(['aria-label="Total"'])
  })

  test('attributes that are wiring are left alone', () => {
    expect(inSvelte('<input name="amount" class="Big Thing" role="option" id="Save" />')).toEqual(
      [],
    )
  })

  test('comments and styles are not read', () => {
    expect(
      inSvelte("<!-- Some words here -->\n<style>p { font-family: 'Some Font'; }</style>"),
    ).toEqual([])
  })
})

describe('wordsInSvelte: code', () => {
  test('a prose string in the script', () => {
    expect(
      inSvelte('<script lang="ts">\n  const label: string = \'Write it down\'\n</script>'),
    ).toEqual(['Write it down'])
  })

  test('a prose string in a markup expression', () => {
    expect(inSvelte("<p>{description || 'No description'}</p>")).toEqual(['No description'])
    expect(inSvelte("<input aria-label={open ? 'Close it' : 'Open it'} />")).toEqual([
      'Close it',
      'Open it',
    ])
  })

  test('says which line it is on', () => {
    expect(wordsInSvelte('<div>\n\n  <p>Save</p>\n</div>')).toEqual([{ text: 'Save', line: 3 }])
    expect(wordsInSvelte("<script>\n\n  const a = 'Two words'\n</script>")).toEqual([
      { text: 'Two words', line: 3 },
    ])
  })
})

describe('wordsInTs', () => {
  test('a prose string, and the words in a template', () => {
    expect(inTs("const a = 'Write it down'")).toEqual(['Write it down'])
    // biome-ignore lint/suspicious/noTemplateCurlyInString: TypeScript source, as a fixture
    expect(inTs('const b = `It was refused as ${code}.`')).toEqual(['It was refused as'])
  })

  test('says which line it is on', () => {
    expect(wordsInTs("\n\nconst a = 'Two words'")).toEqual([{ text: 'Two words', line: 3 }])
  })

  test('words for developers are left alone, by where they sit', () => {
    expect(
      inTs(
        [
          "throw new Error('A local version lost')",
          "throw new RangeError('Not an amount at all')",
          "console.error('Opening failed badly')",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: TypeScript source, as a fixture
          'log.info(`${name} ${ms}ms ok`)',
          "log.error('Something threw here', e)",
        ].join('\n'),
      ),
    ).toEqual([])
  })

  test('SQL is left alone', () => {
    expect(
      inTs(
        [
          "db.prepare('SELECT count(*) FROM transactions').pluck().get()",
          "db.pragma('journal_mode = WAL')",
          "db.exec('DROP TABLE things')",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: TypeScript source, as a fixture
          'const s = sql`sum(${postings.amountCents}) over all`',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  test('module names, types and keys are not words', () => {
    expect(
      inTs(
        [
          "import { a } from 'some place'",
          "export { b } from 'other place'",
          "declare module 'any where' {}",
          "type T = 'Two words' | 'Three more words'",
          "const o = { 'two words': 1 }",
          "const p = await import('a module')",
        ].join('\n'),
      ),
    ).toEqual([])
  })
})
