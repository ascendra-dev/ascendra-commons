import type { CachedResponse } from './cached-response.interface';

export type ClaimResult =
  | { status: 'claimed' } // this request is first — proceed
  | { status: 'completed'; response: CachedResponse } // already finished — return the cached response
  | { status: 'in_progress' }; // a concurrent duplicate, still running elsewhere
