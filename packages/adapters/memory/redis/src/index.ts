// Import ioredis as a value only — do not use the Redis class as a type annotation.
// ioredis's Redis export is a merged class+namespace; using it directly as a type
// causes TS2709 under NodeNext module resolution. We use a structural interface instead.
import RedisLib from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { MemoryError } from '@pravaha/core'
import type { MemoryStore } from '@pravaha/core'

/**
 * Structural interface for the Redis client methods used by this adapter.
 * Decouples the implementation from ioredis's class hierarchy and avoids
 * TypeScript namespace-merge issues with direct Redis type annotations.
 */
interface RedisClient {
  set(key: string, value: string): Promise<string | null>
  set(key: string, value: string, exFlag: 'PX', ms: number): Promise<string | null>
  get(key: string): Promise<string | null>
  del(...keys: string[]): Promise<number>
  exists(...keys: string[]): Promise<number>
  scan(
    cursor: string,
    matchFlag: 'MATCH',
    pattern: string,
    countFlag: 'COUNT',
    count: number,
  ): Promise<[string, string[]]>
  quit(): Promise<string>
}

/** Checks whether a value is a pre-constructed Redis client (duck-type guard). */
function isRedisClient(value: unknown): value is RedisClient {
  const v = value as Record<string, unknown>
  return typeof v['get'] === 'function' && typeof v['set'] === 'function'
}

export interface RedisMemoryStoreConfig {
  /**
   * ioredis connection options OR a pre-constructed Redis instance.
   * Pass a pre-constructed instance when you want to share a connection pool.
   */
  readonly client: RedisClient | RedisOptions
  /**
   * Key prefix for all Pravaha memory entries.
   * Use this to namespace by pipeline or environment.
   * Default: 'pravaha:'
   * @example 'pravaha:unicredit-support:'
   */
  readonly keyPrefix?: string
  /**
   * Default TTL in milliseconds for entries without explicit TTL.
   * Undefined means no expiry.
   */
  readonly defaultTtlMs?: number
}

/**
 * Redis-backed implementation of MemoryStore.
 *
 * Production memory backend. Data persists across process restarts.
 * Supports TTL, key namespacing, and connection reuse.
 *
 * Requires a running Redis instance. For local dev:
 *   docker run -p 6379:6379 redis:7-alpine
 *
 * @example
 * import Redis from 'ioredis'
 * const memory = new RedisMemoryStore({
 *   client: { host: 'redis.internal', port: 6379 },
 *   keyPrefix: 'pravaha:prod:',
 *   defaultTtlMs: 24 * 60 * 60 * 1000, // 24 hours
 * })
 *
 * // Shared client:
 * const redis = new Redis({ host: 'redis.internal' })
 * const memory = new RedisMemoryStore({ client: redis })
 */
export class RedisMemoryStore implements MemoryStore {
  private readonly redis: RedisClient
  private readonly prefix: string
  private readonly defaultTtlMs: number | undefined
  private readonly ownsClient: boolean

  constructor(config: RedisMemoryStoreConfig) {
    if (isRedisClient(config.client)) {
      this.redis = config.client
      this.ownsClient = false
    } else {
      // Cast through unknown to avoid TypeScript's namespace-merge type confusion.
      // At runtime, RedisLib is the ioredis constructor — this is safe.
      const Ctor = RedisLib as unknown as new (opts: RedisOptions) => RedisClient
      this.redis = new Ctor(config.client as RedisOptions)
      this.ownsClient = true
    }
    this.prefix = config.keyPrefix ?? 'pravaha:'
    if (config.defaultTtlMs !== undefined) {
      this.defaultTtlMs = config.defaultTtlMs
    }
  }

  private prefixKey(key: string): string {
    return `${this.prefix}${key}`
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    const prefixed = this.prefixKey(key)
    const serialized = JSON.stringify(value)
    const effectiveTtl = ttlMs ?? this.defaultTtlMs

    try {
      if (effectiveTtl !== undefined) {
        await this.redis.set(prefixed, serialized, 'PX', effectiveTtl)
      } else {
        await this.redis.set(prefixed, serialized)
      }
    } catch (err) {
      throw new MemoryError(
        `Failed to set key '${key}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(this.prefixKey(key))
      if (value === null) return null
      return JSON.parse(value) as T
    } catch (err) {
      throw new MemoryError(
        `Failed to get key '${key}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(this.prefixKey(key))
    } catch (err) {
      throw new MemoryError(
        `Failed to delete key '${key}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(this.prefixKey(key))
      return exists === 1
    } catch (err) {
      throw new MemoryError(
        `Failed to check key '${key}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  async clear(): Promise<void> {
    try {
      // Use SCAN to avoid blocking Redis with KEYS on large datasets
      let cursor = '0'
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${this.prefix}*`,
          'COUNT',
          100,
        )
        cursor = nextCursor
        if (keys.length > 0) {
          await this.redis.del(...keys)
        }
      } while (cursor !== '0')
    } catch (err) {
      throw new MemoryError(
        `Failed to clear memory: ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  async keys(prefix?: string): Promise<readonly string[]> {
    try {
      const pattern = `${this.prefix}${prefix ?? ''}*`
      const result: string[] = []
      let cursor = '0'

      do {
        const [nextCursor, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
        cursor = nextCursor
        // Strip the Pravaha prefix before returning to caller
        result.push(...batch.map((k: string) => k.slice(this.prefix.length)))
      } while (cursor !== '0')

      return result
    } catch (err) {
      throw new MemoryError(
        `Failed to list keys: ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
  }

  /**
   * Gracefully disconnect from Redis.
   * Only closes the connection if this instance owns it (created from config, not injected).
   */
  async disconnect(): Promise<void> {
    if (this.ownsClient) {
      await this.redis.quit()
    }
  }

  /**
   * Expose the underlying Redis client for advanced operations.
   * Use sparingly — prefer MemoryStore interface methods.
   */
  get client(): RedisClient {
    return this.redis
  }
}
