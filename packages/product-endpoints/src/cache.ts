/**
 * Small in-memory TTL cache with in-flight de-duplication: concurrent requests for the
 * same key share one upstream call, and failures are never cached.
 */

export interface CacheResult<T> {
  value: T;
  /** True when served from cache (or joined an in-flight load). */
  hit: boolean;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns the cached value or loads, stores and returns a fresh one. */
  async getOrLoad(key: string, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > this.now()) {
      return { value: entry.value, hit: true };
    }
    if (entry) this.entries.delete(key);

    const pending = this.inflight.get(key);
    if (pending) return { value: await pending, hit: true };

    const load = loader();
    this.inflight.set(key, load);
    try {
      const value = await load;
      this.set(key, value);
      return { value, hit: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Stores a value, evicting the oldest entry when full (Map keeps insertion order). */
  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
