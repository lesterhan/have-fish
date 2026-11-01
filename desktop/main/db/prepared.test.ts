import Database from 'better-sqlite3'
import { expect, onTestFinished, test, vi } from 'vitest'
import { perConnection } from './prepared'

test('builds the statements once per connection, and each connection its own', () => {
  const make = vi.fn(() => ({}))
  const statements = perConnection(make)
  const [a, b] = [new Database(':memory:'), new Database(':memory:')]
  onTestFinished(() => {
    a.close()
    b.close()
  })

  expect(statements(a)).toBe(statements(a))
  expect(statements(b)).not.toBe(statements(a))
  expect(make).toHaveBeenCalledTimes(2)
})
