import { describe, it, expect } from 'bun:test'
import {
  affectedPaths,
  branchPaths,
  buildCategoryTree,
  categorySections,
  emptyRows,
  filterNodes,
  findCollision,
  flattenNodes,
  isDeletable,
  parentPrefix,
  pathError,
  renameTarget,
  segmentError,
  type CategoryAccount,
  type CategoryNode,
  type CategoryStat,
} from './categoryTree'
import type { Roots } from './accountPaths'

const ROOTS: Roots = {
  assets: 'assets',
  liabilities: 'liabilities',
  equity: 'equity',
  expenses: 'expenses',
  income: 'income',
}

function accts(...paths: string[]): CategoryAccount[] {
  return paths.map((path) => ({ id: `id:${path}`, path }))
}

function stats(
  entries: Record<string, [number, string | null]>,
): Map<string, CategoryStat> {
  return new Map(
    Object.entries(entries).map(([path, [count, lastActivity]]) => [
      `id:${path}`,
      { count, lastActivity },
    ]),
  )
}

const NONE = new Map<string, CategoryStat>()

/** Compact render of a forest: `path(entries)` per line, indented by depth. */
function render(nodes: CategoryNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.segment}(${n.entries})`,
    ...render(n.children, depth + 1),
  ])
}

function find(nodes: CategoryNode[], path: string): CategoryNode {
  for (const node of nodes) {
    if (node.path === path) return node
    if (path.startsWith(`${node.path}:`)) return find(node.children, path)
  }
  throw new Error(`no node at ${path}`)
}

describe('buildCategoryTree', () => {
  it('creates virtual nodes for segments nothing was filed at', () => {
    const tree = buildCategoryTree(accts('expenses:food:groceries'), NONE)

    expect(render(tree)).toEqual(['expenses(0)', '  food(0)', '    groceries(0)'])
    expect(find(tree, 'expenses').accountId).toBeNull()
    expect(find(tree, 'expenses:food:groceries').accountId).toBe(
      'id:expenses:food:groceries',
    )
  })

  it('rolls entry counts up the subtree while keeping each row own count', () => {
    const tree = buildCategoryTree(
      accts('expenses:food', 'expenses:food:groceries', 'expenses:rent'),
      stats({
        'expenses:food': [2, '2026-01-01'],
        'expenses:food:groceries': [40, '2026-05-05'],
        'expenses:rent': [12, '2026-04-04'],
      }),
    )

    expect(render(tree)).toEqual([
      'expenses(54)',
      '  food(42)',
      '    groceries(40)',
      '  rent(12)',
    ])
    expect(find(tree, 'expenses:food').ownEntries).toBe(2)
    expect(find(tree, 'expenses').ownEntries).toBe(0)
  })

  it('rolls last use up as the latest date anywhere beneath', () => {
    const tree = buildCategoryTree(
      accts('expenses:food:groceries', 'expenses:food:dining', 'expenses:rent'),
      stats({
        'expenses:food:groceries': [1, '2026-02-02'],
        'expenses:food:dining': [1, '2026-08-08'],
        'expenses:rent': [1, null],
      }),
    )

    expect(find(tree, 'expenses:food').lastUsed).toBe('2026-08-08')
    expect(find(tree, 'expenses').lastUsed).toBe('2026-08-08')
    expect(find(tree, 'expenses:rent').lastUsed).toBeNull()
  })

  it('sorts every level alphabetically', () => {
    const tree = buildCategoryTree(
      accts('income:salary', 'expenses:rent', 'expenses:food'),
      NONE,
    )
    expect(render(tree)).toEqual([
      'expenses(0)',
      '  food(0)',
      '  rent(0)',
      'income(0)',
      '  salary(0)',
    ])
  })

  it('handles an empty list', () => {
    expect(buildCategoryTree([], NONE)).toEqual([])
  })
})

describe('isDeletable', () => {
  const tree = buildCategoryTree(
    accts('expenses:food', 'expenses:food:groceries', 'expenses:unused'),
    stats({ 'expenses:food:groceries': [40, '2026-05-05'] }),
  )

  it('allows an unused leaf with a real row', () => {
    expect(isDeletable(find(tree, 'expenses:unused'))).toBe(true)
  })

  it('refuses a row that still has entries', () => {
    expect(isDeletable(find(tree, 'expenses:food:groceries'))).toBe(false)
  })

  it('refuses a parent, whose zero own-entries sits under a count of 40', () => {
    // Deleting it would be safe — the segment reverts to virtual — but a row reading
    // "40 entries" beside a delete button is a trap, not an affordance.
    const food = find(tree, 'expenses:food')
    expect(food.ownEntries).toBe(0)
    expect(food.entries).toBe(40)
    expect(isDeletable(food)).toBe(false)
  })

  it('refuses a virtual node, which has no row to delete', () => {
    expect(isDeletable(find(tree, 'expenses'))).toBe(false)
  })
})

describe('categorySections', () => {
  const accounts = accts(
    'expenses:food',
    'expenses:rent',
    'income:salary',
    'assets:chequing',
    '储蓄:中国银行',
  )

  it('keeps expenses, income and unfiled, and leaves the Accounts tab alone', () => {
    const sections = categorySections(accounts, NONE, ROOTS)
    expect(sections.map((s) => s.key)).toEqual(['expenses', 'income', 'unfiled'])
    expect(sections.flatMap((s) => render(s.nodes))).not.toContain('chequing(0)')
  })

  it('unwraps the configured root so the section lists its categories directly', () => {
    const [expenses] = categorySections(accounts, NONE, ROOTS)
    expect(render(expenses!.nodes)).toEqual(['food(0)', 'rent(0)'])
  })

  it('keeps the root row when an account exists at exactly the root path', () => {
    // Losing a row is the one thing this page must never do, so a real `expenses` row stays.
    const sections = categorySections(
      accts('expenses', 'expenses:food'),
      NONE,
      ROOTS,
    )
    expect(render(sections[0]!.nodes)).toEqual(['expenses(0)', '  food(0)'])
  })

  it('honours renamed roots', () => {
    const renamed: Roots = { ...ROOTS, expenses: 'spending' }
    const sections = categorySections(
      accts('spending:food', 'expenses:food'),
      NONE,
      renamed,
    )
    expect(sections.map((s) => s.key)).toEqual(['expenses', 'unfiled'])
    // With the root renamed, the old `expenses:*` path is what has nowhere else to go.
    expect(render(sections[0]!.nodes)).toEqual(['food(0)'])
    expect(render(sections[1]!.nodes)).toEqual(['expenses(0)', '  food(0)'])
  })

  it('drops a section with nothing in it rather than showing an empty card', () => {
    expect(
      categorySections(accts('expenses:food'), NONE, ROOTS).map((s) => s.key),
    ).toEqual(['expenses'])
  })

  it('totals entries across the whole section', () => {
    const sections = categorySections(
      accts('expenses:food', 'expenses:rent'),
      stats({ 'expenses:food': [3, null], 'expenses:rent': [4, null] }),
      ROOTS,
    )
    expect(sections[0]!.entries).toBe(7)
  })
})

describe('filterNodes', () => {
  const tree = buildCategoryTree(
    accts(
      'expenses:food:groceries',
      'expenses:food:dining',
      'expenses:rent',
      'expenses:travel:flights',
    ),
    stats({ 'expenses:food:groceries': [40, '2026-05-05'] }),
  )

  it('keeps a match together with the ancestors that give it context', () => {
    const kept = filterNodes(tree, (n) => n.segment === 'groceries')
    expect(render(kept)).toEqual(['expenses(40)', '  food(40)', '    groceries(40)'])
  })

  it('keeps everything beneath a matched branch', () => {
    const kept = filterNodes(tree, (n) => n.segment === 'food')
    expect(render(kept)).toEqual([
      'expenses(40)',
      '  food(40)',
      '    dining(0)',
      '    groceries(40)',
    ])
  })

  it('leaves the rolled-up counts alone — they describe the tree, not the filter', () => {
    const kept = filterNodes(tree, (n) => n.segment === 'dining')
    expect(find(kept, 'expenses:food').entries).toBe(40)
  })

  it('returns nothing when nothing matches', () => {
    expect(filterNodes(tree, () => false)).toEqual([])
  })

  it('does not mutate the tree it filtered', () => {
    filterNodes(tree, (n) => n.segment === 'groceries')
    expect(find(tree, 'expenses:food').children).toHaveLength(2)
  })
})

describe('emptyRows', () => {
  it('finds every deletable row anywhere in the forest', () => {
    const tree = buildCategoryTree(
      accts(
        'expenses:food',
        'expenses:food:groceries',
        'expenses:food:dining',
        'expenses:unused',
      ),
      stats({ 'expenses:food:groceries': [40, '2026-05-05'] }),
    )
    expect(emptyRows(tree).map((n) => n.path)).toEqual([
      'expenses:food:dining',
      'expenses:unused',
    ])
  })

  it('is empty when everything is in use', () => {
    const tree = buildCategoryTree(
      accts('expenses:food'),
      stats({ 'expenses:food': [1, '2026-01-01'] }),
    )
    expect(emptyRows(tree)).toEqual([])
  })
})

describe('flattenNodes', () => {
  const tree = buildCategoryTree(
    accts('expenses:food:groceries', 'expenses:rent'),
    NONE,
  )

  it('walks depth-first, carrying the depth a table cannot nest', () => {
    const rows = flattenNodes(tree, () => false)
    expect(rows.map((r) => [r.node.segment, r.depth])).toEqual([
      ['expenses', 0],
      ['food', 1],
      ['groceries', 2],
      ['rent', 1],
    ])
  })

  it('stops at a collapsed branch but still emits the branch itself', () => {
    const rows = flattenNodes(tree, (path) => path === 'expenses:food')
    expect(rows.map((r) => r.node.segment)).toEqual(['expenses', 'food', 'rent'])
    expect(rows.find((r) => r.node.segment === 'food')).toMatchObject({
      hasChildren: true,
      collapsed: true,
    })
  })

  it('never marks a leaf collapsed, however the predicate answers', () => {
    const rows = flattenNodes(tree, () => true)
    expect(rows.find((r) => r.node.segment === 'expenses')!.collapsed).toBe(true)
    expect(rows).toHaveLength(1)
  })
})

describe('branchPaths', () => {
  it('names every path with children, so collapse-all can reach them', () => {
    const tree = buildCategoryTree(
      accts('expenses:food:groceries', 'expenses:rent'),
      NONE,
    )
    expect(branchPaths(tree)).toEqual(['expenses', 'expenses:food'])
  })
})

describe('rename arithmetic', () => {
  const paths = [
    'expenses:food',
    'expenses:food:groceries',
    'expenses:foodstuffs',
    'expenses:rent',
  ]

  it('parentPrefix drops the last segment, and is empty at the top', () => {
    expect(parentPrefix('expenses:food:groceries')).toBe('expenses:food')
    expect(parentPrefix('expenses')).toBe('')
  })

  it('renameTarget replaces the last segment in place', () => {
    expect(renameTarget('expenses:food', 'dining')).toBe('expenses:dining')
    expect(renameTarget('expenses', 'spending')).toBe('spending')
  })

  it('affectedPaths takes the row and its descendants, not its lookalikes', () => {
    // `expenses:foodstuffs` shares a prefix but is not under `expenses:food`.
    expect(affectedPaths(paths, 'expenses:food')).toEqual([
      'expenses:food',
      'expenses:food:groceries',
    ])
  })

  it('affectedPaths covers a virtual node, which has descendants but no row', () => {
    expect(affectedPaths(['expenses:food:groceries'], 'expenses:food')).toEqual([
      'expenses:food:groceries',
    ])
  })

  it('findCollision names the path already sitting at the target', () => {
    expect(findCollision(paths, 'expenses:food', 'expenses:rent')).toBe(
      'expenses:rent',
    )
  })

  it('findCollision catches a descendant landing on an existing row', () => {
    const withTarget = [...paths, 'expenses:dining:groceries']
    expect(findCollision(withTarget, 'expenses:food', 'expenses:dining')).toBe(
      'expenses:dining:groceries',
    )
  })

  it('findCollision ignores the moved subtree colliding with itself', () => {
    expect(findCollision(paths, 'expenses:food', 'expenses:dining')).toBeNull()
  })

  it('segmentError rejects a colon, which would re-parent rather than rename', () => {
    expect(segmentError('food:drink', 'food')).toBe('A name cannot contain a colon')
    expect(segmentError('  ', 'food')).toBe('A name cannot be empty')
    expect(segmentError('dining', 'food')).toBeNull()
  })
})

describe('pathError', () => {
  const existing = ['expenses:food']

  it('says nothing while the box is still empty', () => {
    expect(pathError('', existing)).toBeNull()
    expect(pathError('   ', existing)).toBeNull()
  })

  it('rejects the malformed paths the server would reject', () => {
    expect(pathError('expenses::food', existing)).not.toBeNull()
    expect(pathError(':food', existing)).not.toBeNull()
    expect(pathError('expenses:', existing)).not.toBeNull()
    expect(pathError('expenses: food', existing)).not.toBeNull()
  })

  it('rejects a path you already have', () => {
    expect(pathError('expenses:food', existing)).toBe('That account already exists')
  })

  it('accepts a new well-formed path, trimmed', () => {
    expect(pathError('  expenses:travel:flights  ', existing)).toBeNull()
    expect(pathError('groceries', existing)).toBeNull()
  })
})
