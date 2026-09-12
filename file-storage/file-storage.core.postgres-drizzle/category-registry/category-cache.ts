/**
 * A tiny time-based memo for the category catalog. `AttachmentService.attach`
 * resolves a category on every upload; a short TTL collapses repeat lookups
 * within a bounded staleness window (an admin edit is visible after at most
 * `ttlMs`). Per-process, not shared. `ttlMs <= 0` disables it.
 *
 * Same posture as `notification.core.database`'s `ConfigCache`.
 */
export class CategoryCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) return load();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const value = await load();
    if (this.entries.size >= this.maxEntries) this.evictExpired();
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  /** Called after any admin write — the next read reloads. */
  clear(): void {
    this.entries.clear();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [k, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(k);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}
