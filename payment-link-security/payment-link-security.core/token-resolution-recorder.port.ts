/**
 * One `resolve()` call, as observed by the service. **Never the raw token** —
 * see `TokenResolutionRecorder`'s own doc comment.
 */
export interface TokenResolutionAttempt {
  /**
   * `'resolved'` — a valid, unrevoked token.
   * `'not_found'` — no token matches (unknown, or a guess).
   * `'revoked'` — a real token, but the underlying resource is no longer payable.
   *
   * `'not_found'` at volume, or from one source repeatedly, is the
   * enumeration/brute-force signal `rate-limiting`'s own defense targets —
   * this is the corresponding observability half, not a replacement for it.
   */
  outcome: 'resolved' | 'not_found' | 'revoked';
  /** The caller-supplied correlation id, when threaded through `resolve()`, for a cross-module trace. */
  correlationId?: string;
}

/**
 * The resolution-log port. A `PaymentLinkTokenService` implementation calls
 * `recordAttempt()` once per `resolve()` call. **Best-effort by contract: an
 * implementation must not throw** — a failure to log a resolution attempt
 * must never change whether the payer's own request succeeds.
 *
 * Bound under `TOKEN_RESOLUTION_RECORDER`; `NoopTokenResolutionRecorder`
 * (this package) is the default when nothing is configured.
 */
export interface TokenResolutionRecorder {
  /**
   * `token` is the **raw** token — this method (not the caller) is
   * responsible for hashing it before persisting anything. Never store or
   * log the raw value; a resolution log that leaked raw tokens would itself
   * become the exact liability the tokens' entropy exists to avoid.
   */
  recordAttempt(token: string, attempt: TokenResolutionAttempt): Promise<void>;
}
