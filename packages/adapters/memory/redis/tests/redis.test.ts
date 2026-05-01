import { describe, it, expect, vi, beforeEach } from 'vitest'
import Redis from 'ioredis'
import { RedisMemoryStore } from '../src/index.js'
import { MemoryError } from '@pravaha/core'

/**
 * Unit tests mock the Redis client.
 * Integration tests require a running Redis instance — run with:
 *   REDIS_URL=redis://localhost:6379 pnpm test:integration
 */
describe('RedisMemoryStore (unit)', () => {
  /**
   * Creates a mock that passes `instanceof Redis` without triggering a real connection.
   * `Object.create(Redis.prototype)` sets up the prototype chain without running the constructor.
   */
  function createMockRedis() {
    return Object.assign(Object.create(Redis.prototype) as Redis, {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
      exists: vi.fn().mockResolvedValue(0),
      scan: vi.fn().mockResolvedValue(['0', []]),
      quit: vi.fn().mockResolvedValue('OK'),
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets a value with TTL', async () => {
    const mockRedis = createMockRedis()
    const store = new RedisMemoryStore({ client: mockRedis })

    await store.set('test-key', { value: 42 }, 5000)

    expect(mockRedis.set).toHaveBeenCalledWith(
      'pravaha:test-key',
      JSON.stringify({ value: 42 }),
      'PX',
      5000,
    )
  })

  it('sets a value without TTL', async () => {
    const mockRedis = createMockRedis()
    const store = new RedisMemoryStore({ client: mockRedis })

    await store.set('test-key', 'hello')

    expect(mockRedis.set).toHaveBeenCalledWith('pravaha:test-key', '"hello"')
  })

  it('applies key prefix correctly', async () => {
    const mockRedis = createMockRedis()
    const store = new RedisMemoryStore({
      client: mockRedis,
      keyPrefix: 'pravaha:unicredit:',
    })

    await store.set('ticket-123', { status: 'open' })

    expect(mockRedis.set).toHaveBeenCalledWith(
      'pravaha:unicredit:ticket-123',
      JSON.stringify({ status: 'open' }),
    )
  })

  it('returns null on cache miss', async () => {
    const mockRedis = createMockRedis()
    mockRedis.get.mockResolvedValue(null)
    const store = new RedisMemoryStore({ client: mockRedis })

    const result = await store.get('missing-key')

    expect(result).toBeNull()
  })

  it('deserializes stored JSON on get', async () => {
    const mockRedis = createMockRedis()
    mockRedis.get.mockResolvedValue(JSON.stringify({ name: 'pravaha', version: '0.1.0' }))
    const store = new RedisMemoryStore({ client: mockRedis })

    const result = await store.get<{ name: string; version: string }>('config')

    expect(result?.name).toBe('pravaha')
    expect(result?.version).toBe('0.1.0')
  })

  it('strips prefix from keys() results', async () => {
    const mockRedis = createMockRedis()
    mockRedis.scan.mockResolvedValue(['0', ['pravaha:key1', 'pravaha:key2']])
    const store = new RedisMemoryStore({ client: mockRedis })

    const keys = await store.keys()

    expect(keys).toEqual(['key1', 'key2'])
  })

  it('uses SCAN not KEYS for clear() — safe for large datasets', async () => {
    const mockRedis = createMockRedis()
    mockRedis.scan
      .mockResolvedValueOnce(['42', ['pravaha:k1', 'pravaha:k2']])
      .mockResolvedValueOnce(['0', ['pravaha:k3']])
    const store = new RedisMemoryStore({ client: mockRedis })

    await store.clear()

    expect(mockRedis.scan).toHaveBeenCalledTimes(2)
    expect(mockRedis.del).toHaveBeenCalledTimes(2)
  })

  it('wraps Redis errors in MemoryError', async () => {
    const mockRedis = createMockRedis()
    mockRedis.set.mockRejectedValue(new Error('Connection refused'))
    const store = new RedisMemoryStore({ client: mockRedis })

    await expect(store.set('key', 'value')).rejects.toThrow(MemoryError)
  })

  it('applies defaultTtlMs when no TTL specified', async () => {
    const mockRedis = createMockRedis()
    const store = new RedisMemoryStore({
      client: mockRedis,
      defaultTtlMs: 3_600_000,
    })

    await store.set('key', 'value')

    expect(mockRedis.set).toHaveBeenCalledWith('pravaha:key', '"value"', 'PX', 3_600_000)
  })
})
