// What each account holds, as a tree: a parent's balance is its own and its children's, rolled
// up per currency, the way hledger's balance report shows it.
// An account at a root itself is a line beside the root's children, holding its own money only.

/** An account and what its own postings sum to in each currency, in cents. */
export type Held = { id: string; path: string; totals: readonly Total[] }

export type Total = { currency: string; cents: number }

/** One line of the tree, in the order it shows. */
export type BalanceRow = {
  /** The account's id; null for a parent nobody added, there because a child's name has it. */
  id: string | null
  path: string
  /** Its root (`assets`), which says whether it's money I have or owe. */
  root: string
  /** The last part of its name: what it shows as under its parent. */
  label: string
  /** How many parents it has below its root. */
  depth: number
  /** Its own and everything under it, by currency code; what sums to zero is left out. */
  totals: Total[]
}

type Node = { id: string | null; path: string; children: Map<string, Node>; own: Total[] }

/**
 * Every account I hold, with each parent its name implies, depth first. Siblings, and the top
 * level across roots, go by name without regard to case.
 */
export function balanceRows(accounts: readonly Held[]): BalanceRow[] {
  // The roots are only containers: their children are the top level, beside any account at a root.
  const roots = new Map<string, Node>()
  for (const account of accounts) {
    const [root = '', ...parts] = account.path.split(':')
    let level = roots
    let path = root
    let node: Node | undefined
    if (parts.length === 0) {
      node = { id: null, path: root, children: new Map(), own: [] }
      roots.set(root, node)
    }
    for (const part of parts) {
      path = `${path}:${part}`
      node = level.get(path)
      if (node === undefined) {
        node = { id: null, path, children: new Map(), own: [] }
        level.set(path, node)
      }
      level = node.children
    }
    if (node !== undefined) {
      node.id = account.id
      node.own = [...account.totals]
    }
  }

  const rows: BalanceRow[] = []
  /** Adds the rows for `nodes` and everything under them; returns what they hold together. */
  const walk = (nodes: Iterable<Node>, depth: number): Map<string, number> => {
    const sum = new Map<string, number>()
    for (const node of sorted(nodes)) {
      // Its row goes above its children's, so it's added first and its totals filled after.
      const row: BalanceRow = {
        id: node.id,
        path: node.path,
        root: rootOfPath(node.path),
        label: labelOf(node),
        depth,
        totals: [],
      }
      rows.push(row)
      const totals = walk(node.children.values(), depth + 1)
      for (const { currency, cents } of node.own) add(totals, currency, cents)
      for (const [currency, cents] of totals) add(sum, currency, cents)
      row.totals = [...totals]
        .filter(([, cents]) => cents !== 0)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([currency, cents]) => ({ currency, cents }))
    }
    return sum
  }
  walk([...roots.values()], 0)
  return rows
}

const byName = new Intl.Collator('en', { sensitivity: 'accent' })

const labelOf = (n: Node) => n.path.slice(n.path.lastIndexOf(':') + 1)

/** The part before the first colon; all of it for an account at a root (`assets`). */
function rootOfPath(path: string) {
  const colon = path.indexOf(':')
  return colon === -1 ? path : path.slice(0, colon)
}

/** By name, case aside; the same name under two roots in root order. */
const sorted = (nodes: Iterable<Node>) =>
  [...nodes].sort((a, b) => byName.compare(labelOf(a), labelOf(b)) || (a.path < b.path ? -1 : 1))

function add(totals: Map<string, number>, currency: string, cents: number) {
  totals.set(currency, (totals.get(currency) ?? 0) + cents)
}
