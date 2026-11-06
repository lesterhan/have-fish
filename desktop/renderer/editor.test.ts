import { describe, expect, test, vi } from 'vitest'
import type { Bridge, CommandName, ListedTransaction } from '../shared/commands'
import { spendEditor } from './editor'

const listed = (fields: Partial<ListedTransaction> = {}): ListedTransaction => ({
  id: 'a',
  date: '2026-10-29',
  description: 'Coffee',
  amounts: [{ amount: '4.50', currency: 'CAD' }],
  simple: { amount: '4.50', currency: 'CAD' },
  from: 'cash',
  to: 'unsorted',
  fromPath: 'assets:cash',
  toPath: 'expenses:unsorted',
  ...fields,
})

/** An editor over a bridge that answers each command with `answers[name]`, and records it. */
function anEditor(answers: Partial<Record<CommandName, unknown>> = {}) {
  const asked: { name: CommandName; input: unknown }[] = []
  const bridge = {
    async invoke(name: CommandName, input: unknown) {
      asked.push({ name, input })
      return answers[name] ?? { ok: true, value: null }
    },
  } as unknown as Bridge
  const forgetTyping = vi.fn()
  const accounts = [{ id: 'visa-id', name: 'visa' }]
  const editor = spendEditor({ bridge, accounts: () => accounts, forgetTyping })
  return { editor, asked, forgetTyping }
}

const caughtUp = () => Promise.resolve()

describe('the spend editor', () => {
  test('one map of drafts, whoever edits: a draft made in one place is there in another', () => {
    const { editor } = anEditor()
    const seen: number[] = []
    editor.subscribe((s) => seen.push(s.drafts.size))
    editor.edit(listed(), 'amount', '5')
    editor.edit(listed({ id: 'b' }), 'description', 'Tea')
    expect([...editor.current().drafts.keys()]).toEqual(['a', 'b'])
    expect(seen).toEqual([0, 1, 2])
  })

  test('typed back to what is saved, the draft goes; a spend it cannot edit makes none', () => {
    const { editor } = anEditor()
    editor.edit(listed(), 'amount', '5')
    editor.edit(listed(), 'amount', '4.50')
    expect(editor.current().drafts.size).toBe(0)
    editor.edit(listed({ simple: null }), 'amount', '5')
    expect(editor.current().drafts.size).toBe(0)
  })

  test('put back: the draft goes', () => {
    const { editor } = anEditor()
    editor.edit(listed(), 'amount', '5')
    editor.revert('a')
    expect(editor.current().drafts.size).toBe(0)
  })

  test('a save sends To only when it moved from where it started, as an account when it names one', async () => {
    const { editor, asked } = anEditor()
    editor.edit(listed(), 'amount', '5')
    editor.edit(listed({ id: 'b' }), 'to', 'visa')
    await editor.save(['a', 'b'], false, caughtUp)
    expect(asked.map((a) => a.input)).toEqual([
      { id: 'a', description: 'Coffee', amount: '5' },
      { id: 'b', description: 'Coffee', amount: '4.50', to: { account: 'visa-id' } },
    ])
    expect(editor.current().drafts.size).toBe(0)
  })

  test('the row a draft started from decides what moved, though the place showing it has gone', async () => {
    const { editor, asked } = anEditor()
    editor.edit(listed(), 'to', 'food')
    // The same spend, as another place shows it a moment later.
    editor.edit(listed({ to: 'food' }), 'amount', '5')
    await editor.save(['a'], false, caughtUp)
    expect(asked[0]?.input).toMatchObject({ to: { category: 'food' } })
  })

  test('the lists catch up before the draft goes, and the fields forget their typing', async () => {
    const { editor, forgetTyping } = anEditor()
    editor.edit(listed(), 'amount', '5')
    const order: string[] = []
    editor.subscribe((s) => order.push(`drafts ${s.drafts.size}`))
    await editor.save(['a'], false, async () => {
      order.push('caught up')
    })
    expect(order).toEqual(['drafts 1', 'drafts 1', 'caught up', 'drafts 0'])
    expect(forgetTyping).toHaveBeenCalledOnce()
  })

  test('refused: the draft stays and says why, and nothing catches up', async () => {
    const { editor } = anEditor({
      'spend.edit': { ok: false, error: 'AMOUNT_INVALID', detail: { amount: 'abc' } },
    })
    editor.edit(listed(), 'amount', 'abc')
    const catching = vi.fn(caughtUp)
    await editor.save(['a'], false, catching)
    expect(editor.current().drafts.get('a')?.error?.field).toBe('amount')
    expect(catching).not.toHaveBeenCalled()
  })

  test('Save all sends every draft as one command', async () => {
    const { editor, asked } = anEditor({
      'spend.saveAll': { ok: true, value: [{ refused: null }, { refused: null }] },
    })
    editor.edit(listed(), 'amount', '5')
    editor.edit(listed({ id: 'b' }), 'amount', '6')
    await editor.save(editor.current().drafts.keys(), true, caughtUp)
    expect(asked.map((a) => a.name)).toEqual(['spend.saveAll'])
    expect(editor.current().drafts.size).toBe(0)
  })

  test('one save at a time', async () => {
    const { editor, asked } = anEditor()
    editor.edit(listed(), 'amount', '5')
    const first = editor.save(['a'], false, caughtUp)
    await editor.save(['a'], false, caughtUp)
    await first
    expect(asked).toHaveLength(1)
  })

  test('removed: its draft goes; refused, main says why and the draft stays', async () => {
    const { editor } = anEditor()
    editor.edit(listed(), 'amount', '5')
    expect(await editor.remove('a')).toBeNull()
    expect(editor.current().drafts.size).toBe(0)

    const refusing = anEditor({ 'spend.remove': { ok: false, error: 'NOT_FOUND', detail: {} } })
    refusing.editor.edit(listed(), 'amount', '5')
    expect(await refusing.editor.remove('a')).toMatchObject({ error: 'NOT_FOUND' })
    expect(refusing.editor.current().drafts.size).toBe(1)
  })
})
