import type { CachedResponse } from './cached-response.interface';
import type { ClaimResult } from './claim-result';

/**
 * An atomic claim, not check-then-act — a plain get() then save() is not
 * safe even against one shared table: two requests carrying the same key
 * arriving close together can both see "nothing cached yet" before either
 * has written its own entry. The claim itself must be atomic at the
 * database level; see PostgresIdempotencyStore.
 */
export interface IdempotencyStore {
  claim(key: string, scope: string): Promise<ClaimResult>;
  complete(key: string, scope: string, response: CachedResponse): Promise<void>;
}
