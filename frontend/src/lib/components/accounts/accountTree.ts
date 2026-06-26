// ════════════════════════════════════════════════════════════
//  ACCOUNT TREE
//
//  Ported from the design handoff (pg/accounts.js — tree helpers only;
//  the mock ACCOUNTS array is not ported). Builds a nested tree from the
//  flat account list so the breadcrumb-drill column can list a level's
//  siblings. Subtree frequency bubbles up (a parent's weight = sum of its
//  descendants') so columns can sort by aggregate usage.
//
//  Frequency is currently always 0 (see the epic — freq wiring is a
//  follow-up), so the sort degrades to alphabetical by path. Keep the
//  freq-desc-then-path-asc ordering so it lights up cleanly once real
//  posting counts are supplied.
// ════════════════════════════════════════════════════════════

const SEP = ':'

/** The minimal shape the tree builder needs from an account. */
export interface TreeAccount {
  path: string
  freq?: number
}

export interface TreeNode {
  /** The single segment name (e.g. "food"), or "" for the synthetic root. */
  name: string
  /** The full colon-delimited path to this node ("" for the root). */
  path: string
  children: Map<string, TreeNode>
  /** Aggregate usage: the sum of this subtree's account frequencies. */
  freq: number
  /** True when an account exists at exactly this path (vs. a pure parent). */
  isAccount: boolean
}

export interface AccountTree {
  root: TreeNode
  /** Children of `path` ("" = roots), sorted by subtree freq desc, then path asc. */
  childrenOf(path: string): TreeNode[]
  /** The node at `path` ("" = root), or null if no such path exists. */
  nodeAt(path: string): TreeNode | null
}

function newNode(name: string, path: string): TreeNode {
  return { name, path, children: new Map(), freq: 0, isAccount: false }
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => b.freq - a.freq || a.path.localeCompare(b.path))
}

/** Build a nested tree from a flat account list. */
export function buildTree(accounts: TreeAccount[]): AccountTree {
  const root = newNode('', '')

  for (const { path, freq = 0 } of accounts) {
    const segs = path.split(SEP)
    let node = root
    let acc = ''
    segs.forEach((seg, i) => {
      acc = acc ? acc + SEP + seg : seg
      let child = node.children.get(seg)
      if (!child) {
        child = newNode(seg, acc)
        node.children.set(seg, child)
      }
      node = child
      node.freq += freq // subtree weight bubbles up
      if (i === segs.length - 1) node.isAccount = true
    })
  }

  function nodeAt(path: string): TreeNode | null {
    if (!path) return root
    let node: TreeNode = root
    for (const seg of path.split(SEP)) {
      const child = node.children.get(seg)
      if (!child) return null
      node = child
    }
    return node
  }

  function childrenOf(path: string): TreeNode[] {
    const node = nodeAt(path)
    if (!node) return []
    return sortNodes([...node.children.values()])
  }

  return { root, childrenOf, nodeAt }
}
