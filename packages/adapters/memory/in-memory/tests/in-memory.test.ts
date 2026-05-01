import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStore } from '../src/index.js'

describe('InMemoryStore', () => {
  let store: InMemoryStore

  beforeEach(() => {
    store = new InMemoryStore()
  })

  it('sets and gets a value', async () => {
    await store.set('key1', { name: 'pravaha' })
    const result = await store.get<{ name: string }>('key1')
    expect(result?.name).toBe('pravaha')
  })

  it('returns null for missing key', async () => {
    const result = await store.get('nonexistent')
    expect(result).toBeNull()
  })

  it('deletes a key', async () => {
    await store.set('key1', 'value')
    await store.delete('key1')
    const result = await store.get('key1')
    expect(result).toBeNull()
  })

  it('has() returns true for existing key', async () => {
    await store.set('key1', 'value')
    expect(await store.has('key1')).toBe(true)
  })

  it('has() returns false for missing key', async () => {
    expect(await store.has('missing')).toBe(false)
  })

  it('clears all entries', async () => {
    await store.set('k1', 1)
    await store.set('k2', 2)
    await store.clear()
    expect(await store.get('k1')).toBeNull()
    expect(await store.get('k2')).toBeNull()
  })

  it('lists all keys', async () => {
    await store.set('a:1', 1)
    await store.set('a:2', 2)
    await store.set('b:1', 3)
    const keys = await store.keys()
    expect(keys).toContain('a:1')
    expect(keys).toContain('a:2')
    expect(keys).toContain('b:1')
  })

  it('lists keys by prefix', async () => {
    await store.set('a:1', 1)
    await store.set('a:2', 2)
    await store.set('b:1', 3)
    const keys = await store.keys('a:')
    expect(keys).toContain('a:1')
    expect(keys).toContain('a:2')
    expect(keys).not.toContain('b:1')
  })

  it('expires entries after TTL', async () => {
    await store.set('temp', 'value', 50) // 50ms TTL
    expect(await store.get('temp')).toBe('value')
    await new Promise((r) => setTimeout(r, 100))
    expect(await store.get('temp')).toBeNull()
  })

  it('expired keys do not appear in keys()', async () => {
    await store.set('expired', 'value', 50)
    await new Promise((r) => setTimeout(r, 100))
    const keys = await store.keys()
    expect(keys).not.toContain('expired')
  })
})