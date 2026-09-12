/**
 * A payer, typically with no account at all, receives a link and pays — a
 * public URL, reachable by anyone who has it, with no login in front of it.
 * This is the seam between that link and whatever "resource" and "subject"
 * mean in the consuming project (an invoice and a payer, most concretely) —
 * generic on purpose, so this module never depends on a project's own domain
 * types.
 *
 * `resourceId` — whatever the link ultimately grants access to (an invoice
 * id, most concretely). `subjectId` — whose identity the token establishes
 * (a payer id). Both opaque strings to this module; the consuming project's
 * own authorization/RLS layer is what actually does anything with them once
 * `resolve()` succeeds.
 */
export interface PaymentLinkTokenService {
  /** A cryptographically random token, never sequential or derived from `resourceId`/`subjectId` in a guessable way. */
  generate(resourceId: string, subjectId: string): Promise<{ token: string }>;

  /**
   * `null` if the token is unknown or revoked — the caller cannot and should
   * not distinguish those two cases (both fail the same way: `404`, never a
   * hint that a *similar* token might exist). `correlationId` is optional
   * plumbing to the resolution log, for a cross-module trace — never part of
   * how resolution itself is decided.
   */
  resolve(token: string, correlationId?: string): Promise<{ resourceId: string; subjectId: string } | null>;

  /** Revokes every still-valid token issued for `resourceId` — called when the underlying resource becomes non-payable (voided, fully paid). */
  revoke(resourceId: string): Promise<void>;
}
