import type { PravahaId } from '../types/index.js'

/** A single memory entry */
export interface MemoryEntry {
  readonly id: PravahaId
  readonly key: string
  readonly value: unknown
  readonly createdAt: number
  readonly expiresAt?: number
  readonly metadata: Record<string, unknown>
}

/**
 * Port for memory storage.
 * Implement this for any backend: in-memory, Redis, Supabase, etc.
 *
 * All methods return null/undefined on miss — never throw on missing keys.
 */
export interface MemoryStore {
  /** Store a value. Overwrites if key exists. */
  set(key: string, value: unknown, ttlMs?: number): Promise<void>
  /** Retrieve a value. Returns null if not found or expired. */
  get<T = unknown>(key: string): Promise<T | null>
  /** Delete a value. No-op if not found. */
  delete(key: string): Promise<void>
  /** Check if a key exists and is not expired */
  has(key: string): Promise<boolean>
  /** Clear all entries */
  clear(): Promise<void>
  /** List all non-expired keys, optionally filtered by prefix */
  keys(prefix?: string): Promise<readonly string[]>
}
