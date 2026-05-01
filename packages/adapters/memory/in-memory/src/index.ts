import type { MemoryStore } from '@pravaha/core'

interface MemoryRecord {
  value: unknown
  expiresAt?: number
}

/**
 * In-memory implementation of MemoryStore.
 * Default memory backend — no external dependencies.
 * Data is lost when process exits. Use for development and testing.
 */
export class InMemoryStore implements MemoryStore {
  private readonly store = new Map<string, MemoryRecord>()

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      ...(ttlMs !== undefined ? { expiresAt: Date.now() + ttlMs } : {}),
    })
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const record = this.store.get(key)
    if (!record) return null
    if (record.expiresAt !== undefined && Date.now() > record.expiresAt) {
      this.store.delete(key)
      return null
    }
    return record.value as T
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async has(key: string): Promise<boolean> {
    const val = await this.get(key)
    return val !== null
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  async keys(prefix?: string): Promise<readonly string[]> {
    const now = Date.now()
    const result: string[] = []
    for (const [key, record] of this.store.entries()) {
      if (record.expiresAt !== undefined && now > record.expiresAt) continue
      if (!prefix || key.startsWith(prefix)) result.push(key)
    }
    return result
  }
}
