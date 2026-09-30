/**
 * Which files may reach the network (#287, audit P2.3).
 *
 * The local build keeps the personal ledger on the machine: import, reports, coverage and
 * export work with the network unplugged. That holds only while nothing in the ledger's path
 * quietly calls out, so the files that may are listed here, and a call anywhere else fails
 * this test. The places that are meant to talk to the network:
 *
 * - the FX rate source, which fetches a published rate (and is stubbed in every test);
 * - the local launcher's check on the instance its lockfile names, which asks 127.0.0.1 and
 *   nothing else;
 * - `sync/`, the future sync loop (P2b);
 * - the future Fish Pie proxy, which joins this list in the PR that adds it.
 *
 * `test-network-off.ts` is the other half: it makes a call that slips through fail during a
 * test run. This file is why one should never get that far.
 *
 * Read as text, like `dialect.test.ts`. Comments are stripped first, so a sentence that
 * mentions `fetch(` is not a call.
 */

import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const SRC = import.meta.dir

const MAY_REACH_NETWORK: Record<string, string> = {
  'fx/rate-source.ts': 'the published FX rate, the one call the personal ledger makes (L04)',
  'local/holder.ts': "127.0.0.1 only: the running instance's own port, from its lockfile (#516)",
}
const MAY_REACH_NETWORK_UNDER = ['sync/']

/** Every way this codebase could open a connection, as a pattern over code with no comments. */
const NETWORK: Record<string, RegExp> = {
  fetch: /(?<![.\w$])fetch\s*\(/,
  'Bun.connect': /\bBun\.(connect|udpSocket)\s*\(/,
  WebSocket: /\bnew\s+WebSocket\s*\(/,
  XMLHttpRequest: /\bXMLHttpRequest\b/,
  EventSource: /\bnew\s+EventSource\s*\(/,
  'a node network module': /from\s+['"](node:)?(http|https|http2|net|tls|dgram|dns)['"]/,
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [relative(SRC, path)] : []
  })
}

/** The file's code with its comments removed, so prose about `fetch(` is not a call. */
function code(file: string): string {
  const text = readFileSync(join(SRC, file), 'utf8')
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  let out = ''
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue
    }
    out += scanner.getTokenText()
  }
  return out
}

const allowed = (file: string) =>
  file in MAY_REACH_NETWORK || MAY_REACH_NETWORK_UNDER.some((dir) => file.startsWith(dir))

const FILES = sourceFiles(SRC)
const CALLS = FILES.flatMap((file) => {
  const text = code(file)
  return Object.entries(NETWORK)
    .filter(([, pattern]) => pattern.test(text))
    .map(([what]) => ({ file, what }))
})

describe('the network', () => {
  it('is reached only from the files allowed to reach it', () => {
    const outside = CALLS.filter((c) => !allowed(c.file)).map((c) => `${c.file}: ${c.what}`)
    expect(outside).toEqual([])
  })

  it('is reached by every file on the list, so the list can only shrink', () => {
    const stale = Object.keys(MAY_REACH_NETWORK).filter((f) => !CALLS.some((c) => c.file === f))
    expect(stale).toEqual([])
  })

  it('is seen by the patterns, so a pass means something', () => {
    const probe = (text: string) => Object.values(NETWORK).some((p) => p.test(text))
    expect(probe('await fetch(url)')).toBe(true)
    expect(probe("import { request } from 'node:https'")).toBe(true)
    expect(probe("import http from 'http'")).toBe(true)
    expect(probe('Bun.connect({ hostname })')).toBe(true)
    expect(probe('new WebSocket(url)')).toBe(true)
    // A server handing a request to its own app is not a network call.
    expect(probe('server.fetch(request)')).toBe(false)
    expect(probe('app.fetch(req)')).toBe(false)
    expect(probe('fetchPublishedRate(date)')).toBe(false)
  })
})
