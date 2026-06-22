/// <reference types="bun-types" />
import { describe, expect, it } from 'bun:test'
import {
  composeServerUrl,
  DEFAULT_PORT,
  normalizeServerUrl,
  parseServerUrl,
  pushServer,
  SERVERS_CAP,
  type ServerParts,
} from './server-url'

describe('parseServerUrl', () => {
  it('parses a full URL into parts', () => {
    expect(parseServerUrl('https://myserver:8887')).toEqual({
      scheme: 'https',
      host: 'myserver',
      port: '8887',
    })
  })

  it('defaults the scheme to https when absent', () => {
    expect(parseServerUrl('myserver:8887')).toEqual({
      scheme: 'https',
      host: 'myserver',
      port: '8887',
    })
  })

  it('parses a bare host with no port', () => {
    expect(parseServerUrl('myserver')).toEqual({ scheme: 'https', host: 'myserver', port: '' })
  })

  it('lowercases the scheme', () => {
    expect(parseServerUrl('HTTPS://myserver').scheme).toBe('https')
  })

  it('strips trailing slashes and paths', () => {
    expect(parseServerUrl('http://192.168.1.50:8887/api/')).toEqual({
      scheme: 'http',
      host: '192.168.1.50',
      port: '8887',
    })
  })

  it('strips a query string', () => {
    expect(parseServerUrl('http://home.local:8887?x=1').host).toBe('home.local')
  })

  it('treats a non-numeric trailing segment as part of the host, not a port', () => {
    expect(parseServerUrl('myserver:abc')).toEqual({ scheme: 'https', host: 'myserver:abc', port: '' })
  })

  it('trims surrounding whitespace', () => {
    expect(parseServerUrl('  myserver:8887  ').host).toBe('myserver')
  })

  it('handles an empty string', () => {
    expect(parseServerUrl('')).toEqual({ scheme: 'https', host: '', port: '' })
  })
})

describe('composeServerUrl', () => {
  it('joins scheme, host and port', () => {
    const parts: ServerParts = { scheme: 'https', host: 'myserver', port: '8887' }
    expect(composeServerUrl(parts)).toBe('https://myserver:8887')
  })

  it('omits the port when blank', () => {
    expect(composeServerUrl({ scheme: 'http', host: 'myserver', port: '' })).toBe('http://myserver')
  })

  it('returns empty string for a blank host', () => {
    expect(composeServerUrl({ scheme: 'http', host: '   ', port: '8887' })).toBe('')
  })

  it('strips a trailing slash off the host', () => {
    expect(composeServerUrl({ scheme: 'http', host: 'myserver/', port: '8887' })).toBe(
      'http://myserver:8887',
    )
  })
})

describe('normalizeServerUrl', () => {
  it('round-trips a full URL', () => {
    expect(normalizeServerUrl('https://myserver:8887/')).toBe('https://myserver:8887')
  })

  it('canonicalises a bare host:port with default scheme', () => {
    expect(normalizeServerUrl('myserver:8887')).toBe('https://myserver:8887')
  })

  it('is empty for blank input', () => {
    expect(normalizeServerUrl('   ')).toBe('')
  })
})

describe('pushServer', () => {
  it('prepends a new server', () => {
    expect(pushServer(['http://a:8887'], 'http://b:8887')).toEqual([
      'http://b:8887',
      'http://a:8887',
    ])
  })

  it('dedupes by canonical form, floating the reused server to the front', () => {
    const list = ['http://a:8887', 'http://b:8887']
    expect(pushServer(list, 'http://b:8887/')).toEqual(['http://b:8887', 'http://a:8887'])
  })

  it('treats equivalent raw forms as the same server', () => {
    // bare host:port normalises to the same https:// URL — no duplicate.
    expect(pushServer(['https://a:8887'], 'a:8887')).toEqual(['https://a:8887'])
  })

  it('caps the list length, dropping the oldest', () => {
    const list = Array.from({ length: SERVERS_CAP }, (_, i) => `http://h${i}:8887`)
    const next = pushServer(list, 'http://new:8887')
    expect(next).toHaveLength(SERVERS_CAP)
    expect(next[0]).toBe('http://new:8887')
    expect(next).not.toContain(`http://h${SERVERS_CAP - 1}:8887`)
  })

  it('ignores a blank URL', () => {
    expect(pushServer(['http://a:8887'], '   ')).toEqual(['http://a:8887'])
  })
})

describe('constants', () => {
  it('exposes the standard backend port', () => {
    expect(DEFAULT_PORT).toBe('8887')
  })
})
