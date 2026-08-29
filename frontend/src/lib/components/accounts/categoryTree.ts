/**
 * The Categories tab's tree, and the rename arithmetic that goes with it.
 *
 * Categories are `accounts` rows like any other — `expenses:food:groceries` is a real row —
 * so this shares the path model with the Accounts tab and differs only in what it counts:
 * entries and last use rather than balances.
 *
 * Two things live here rather than in the component. The tree, because rolling entries up a
 * subtree and pruning it to a search is the kind of arithmetic that is easier to test than to
 * read. And the rename pre-checks, because renaming `expenses:food` rewrites every path
 * beneath it, and "how many rows does this touch, and does the result collide with something
 * that already exists" is exactly the question a confirm dialog exists to answer.
 */

import {
  SURFACE_LABEL,
  isUnderRoot,
  surfaceOf,
  type Roots,
  type Surface,
} from './accountPaths'

const SEP = ':'

/** The minimal shape the tree needs from `GET /api/accounts`. */
export interface CategoryAccount {
  id: string
  path: string
}

/** Per-account usage, straight from `GET /api/accounts/posting-counts`. */
export interface CategoryStat {
  count: number
  lastActivity: string | null
}

export interface CategoryNode {
  /** The single path segment this node names, e.g. `groceries`. */
  segment: string
  path: string
  /** The account row at exactly this path, or null for a segment nothing was filed at. */
  accountId: string | null
  /** Entries on this node's own row. Zero for a virtual node, and for a real but unused one. */
  ownEntries: number
  /** Entries on this node and everything beneath it — what the tree displays. */
  entries: number
  /** The most recent activity anywhere in this subtree, `YYYY-MM-DD`, or null. */
  lastUsed: string | null
  children: CategoryNode[]
}

/**
 * A row can be deleted only when it is a real account, has no entries of its own, and has
 * nothing beneath it.
 *
 * The first two conditions are what the server enforces. The third is this surface being
 * careful rather than clever: deleting `expenses:food` while `expenses:food:groceries` holds
 * 400 entries is *safe* — paths are materialized, so the parent simply reverts to a virtual
 * grouping segment — but the row says "400 entries" while offering a delete button, and no
 * amount of tooltip makes that read as anything but a trap.
 */
export function isDeletable(node: CategoryNode): boolean {
  return (
    node.accountId !== null &&
    node.ownEntries === 0 &&
    node.children.length === 0
  )
}

function newNode(segment: string, path: string): CategoryNode {
  return {
    segment,
    path,
    accountId: null,
    ownEntries: 0,
    entries: 0,
    lastUsed: null,
    children: [],
  }
}

/** The later of two `YYYY-MM-DD` dates, either of which may be absent. */
function laterOf(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a >= b ? a : b
}

/**
 * Build the forest from flat materialized paths.
 *
 * Segments nobody filed an account at become virtual nodes: `expenses:food:groceries` alone
 * produces `expenses` → `food` → `groceries` where only the leaf carries an id. They are
 * still renamable, because rename matches on the path prefix rather than on an id.
 */
export function buildCategoryTree(
  accounts: readonly CategoryAccount[],
  stats: ReadonlyMap<string, CategoryStat>,
): CategoryNode[] {
  const roots: CategoryNode[] = []
  const byPath = new Map<string, CategoryNode>()

  const ensure = (path: string): CategoryNode => {
    const existing = byPath.get(path)
    if (existing) return existing
    const idx = path.lastIndexOf(SEP)
    const node = newNode(idx === -1 ? path : path.slice(idx + 1), path)
    byPath.set(path, node)
    if (idx === -1) roots.push(node)
    else ensure(path.slice(0, idx)).children.push(node)
    return node
  }

  for (const account of accounts) {
    const node = ensure(account.path)
    node.accountId = account.id
    const stat = stats.get(account.id)
    node.ownEntries = stat?.count ?? 0
    node.lastUsed = stat?.lastActivity ?? null
  }

  // One post-order pass rolls entries and last use up the tree and sorts each level.
  const settle = (node: CategoryNode): void => {
    node.children.sort((a, b) => a.segment.localeCompare(b.segment))
    node.entries = node.ownEntries
    for (const child of node.children) {
      settle(child)
      node.entries += child.entries
      node.lastUsed = laterOf(node.lastUsed, child.lastUsed)
    }
  }
  roots.sort((a, b) => a.segment.localeCompare(b.segment))
  roots.forEach(settle)
  return roots
}

// ── Sections ────────────────────────────────────────────────

export interface CategorySection {
  key: Surface
  label: string
  nodes: CategoryNode[]
  /** Entries across the whole section. */
  entries: number
}

/**
 * Surfaces the Categories tab owns, in the order it shows them.
 *
 * `unfiled` is the safety net the epic makes non-negotiable: an account outside every
 * configured root has to land somewhere, or the tabs between them lose a row.
 */
export const CATEGORY_SURFACES: readonly Surface[] = [
  'expenses',
  'income',
  'unfiled',
]

/**
 * Split the tree into the tab's sections.
 *
 * The configured root node is unwrapped when it is virtual, so the Expenses card lists
 * `food`, `rent`, `travel` rather than one `expenses` row you must open first. It is *not*
 * unwrapped when an account exists at exactly the root path, because that row is real and
 * dropping it would be the one thing this page must never do.
 */
export function categorySections(
  accounts: readonly CategoryAccount[],
  stats: ReadonlyMap<string, CategoryStat>,
  roots: Roots,
): CategorySection[] {
  const sections: CategorySection[] = []
  for (const key of CATEGORY_SURFACES) {
    const mine = accounts.filter((a) => surfaceOf(a.path, roots) === key)
    if (mine.length === 0) continue
    const forest = buildCategoryTree(mine, stats)
    const root = key === 'unfiled' ? '' : roots[key]
    const only = forest.length === 1 ? forest[0]! : null
    const nodes =
      only && only.path === root && only.accountId === null
        ? only.children
        : forest
    sections.push({
      key,
      label: SURFACE_LABEL[key],
      nodes,
      entries: forest.reduce((sum, n) => sum + n.entries, 0),
    })
  }
  return sections
}

// ── Filtering ───────────────────────────────────────────────

/**
 * Prune the forest to nodes matching `keep`, retaining any ancestor of a match.
 *
 * Two rules, in both directions. Ancestors of a match are kept unmatched-but-present, so a
 * hit on `groceries` still reads as `food → groceries` rather than as a segment floating with
 * no context. And a matched *branch* keeps its whole subtree, because searching `food` is a
 * request to see what is filed under food, not to see the word.
 *
 * Rolled-up counts are left alone: `food` says how many entries food has, not how many
 * survived the filter.
 */
export function filterNodes(
  nodes: readonly CategoryNode[],
  keep: (node: CategoryNode) => boolean,
): CategoryNode[] {
  const out: CategoryNode[] = []
  for (const node of nodes) {
    if (keep(node)) {
      out.push(node)
      continue
    }
    const children = filterNodes(node.children, keep)
    if (children.length > 0) out.push({ ...node, children })
  }
  return out
}

/** Every real account row in the forest that `isDeletable` would allow removing. */
export function emptyRows(nodes: readonly CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = []
  const walk = (list: readonly CategoryNode[]) => {
    for (const node of list) {
      if (isDeletable(node)) out.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}

// ── Flattening ──────────────────────────────────────────────

export interface FlatRow {
  node: CategoryNode
  depth: number
  hasChildren: boolean
  collapsed: boolean
}

/**
 * Depth-first walk into rows a template can render as one flat list.
 *
 * A tree of `<tr>`s cannot nest, so the indentation is a depth number rather than markup.
 */
export function flattenNodes(
  nodes: readonly CategoryNode[],
  isCollapsed: (path: string) => boolean,
  depth = 0,
): FlatRow[] {
  const out: FlatRow[] = []
  for (const node of nodes) {
    const hasChildren = node.children.length > 0
    const collapsed = hasChildren && isCollapsed(node.path)
    out.push({ node, depth, hasChildren, collapsed })
    if (hasChildren && !collapsed) {
      out.push(...flattenNodes(node.children, isCollapsed, depth + 1))
    }
  }
  return out
}

/**
 * Every path in the forest, virtual segments included.
 *
 * Search runs over this rather than over the account list, so typing `food` finds the branch
 * even when nothing was filed at `expenses:food` itself.
 */
export function nodePaths(nodes: readonly CategoryNode[]): string[] {
  const out: string[] = []
  const walk = (list: readonly CategoryNode[]) => {
    for (const node of list) {
      out.push(node.path)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * Every real account row in the forest, sorted by path — the Flat view.
 *
 * Virtual segments are left out: the flat list is the one the Settings panel used to show,
 * and that list was rows you could act on, not the shape of the tree.
 */
export function realRows(nodes: readonly CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = []
  const walk = (list: readonly CategoryNode[]) => {
    for (const node of list) {
      if (node.accountId !== null) out.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * One button for fold-all and unfold-all: anything still open means fold, otherwise unfold.
 *
 * Only the named branches change, so folding one section leaves the others as you left them.
 */
export function foldAll(
  collapsed: ReadonlySet<string>,
  branches: readonly string[],
): Set<string> {
  const anyOpen = branches.some((p) => !collapsed.has(p))
  const next = new Set(collapsed)
  for (const p of branches) {
    if (anyOpen) next.add(p)
    else next.delete(p)
  }
  return next
}

/** Every path in the forest that has children — what "collapse all" needs to name. */
export function branchPaths(nodes: readonly CategoryNode[]): string[] {
  const out: string[] = []
  const walk = (list: readonly CategoryNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) {
        out.push(node.path)
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return out
}

// ── Renaming ────────────────────────────────────────────────

/** `expenses:food:groceries` → `expenses:food`; a bare segment has no parent. */
export function parentPrefix(path: string): string {
  const idx = path.lastIndexOf(SEP)
  return idx === -1 ? '' : path.slice(0, idx)
}

/** The path `path` becomes when its last segment is replaced. */
export function renameTarget(path: string, segment: string): string {
  const prefix = parentPrefix(path)
  return prefix ? `${prefix}${SEP}${segment}` : segment
}

/**
 * Why a new segment cannot be used, or null when it can.
 *
 * A colon is the one character that would turn a rename into a re-parent, which the server
 * would accept and the user did not ask for.
 */
export function segmentError(segment: string, current: string): string | null {
  const trimmed = segment.trim()
  if (!trimmed) return 'A name cannot be empty'
  if (trimmed.includes(SEP)) return 'A name cannot contain a colon'
  if (trimmed === current) return null
  return null
}

/** Every real account row rewritten by renaming `path` — itself and its descendants. */
export function affectedPaths(
  allPaths: readonly string[],
  path: string,
): string[] {
  return allPaths.filter((p) => isUnderRoot(p, path)).sort()
}

/**
 * The first path the rename would land on top of, or null when it is clear.
 *
 * Only rows *outside* the moved subtree can collide: the subtree moves with the rename, so
 * it can never collide with itself. A collision is a merge, which the server refuses, so
 * catching it here turns a 400 into a sentence naming the path in the way.
 */
export function findCollision(
  allPaths: readonly string[],
  from: string,
  to: string,
): string | null {
  const moved = affectedPaths(allPaths, from)
  const movedSet = new Set(moved)
  const others = new Set(allPaths.filter((p) => !movedSet.has(p)))
  for (const path of moved) {
    if (others.has(`${to}${path.slice(from.length)}`)) {
      return `${to}${path.slice(from.length)}`
    }
  }
  return null
}

// ── Quick-add ───────────────────────────────────────────────

/**
 * Why a typed path cannot be created, or null when it can.
 *
 * Mirrors the server's `isValidPath` so the message arrives as you type rather than as a 400,
 * and adds the one thing the server cannot know: that you already have this path.
 */
export function pathError(
  raw: string,
  existingPaths: readonly string[],
): string | null {
  const path = raw.trim()
  if (!path) return null
  const segs = path.split(SEP)
  if (segs.some((s) => s.length === 0 || s !== s.trim())) {
    return 'Use single colons between names, with no blank segments'
  }
  if (existingPaths.includes(path)) return 'That account already exists'
  return null
}
