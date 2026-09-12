import { createHash } from 'node:crypto';

/**
 * The one place the raw token becomes a storable, loggable value — a plain
 * SHA-256 hex digest, deterministic (so the same raw token always hashes the
 * same way, letting `resolve()` look it up by equality) but one-way (a
 * leaked `commons_payment_link_token` row never hands back a usable token).
 * Reused by both the token store (to look up by hash instead of storing the
 * raw value) and the resolution recorder (so a resolution-log row can never
 * leak a raw token either) — the same reasoning a password is hashed once,
 * not re-derived differently by every consumer.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
