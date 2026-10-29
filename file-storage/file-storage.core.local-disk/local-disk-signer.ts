import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * What a signed URL grants — one object, until a moment. `filename` and
 * `contentType` say how to serve it (the store keeps bytes only; the record
 * knows what they are).
 */
export interface LocalDiskGrant {
  fileRef: string;
  /** Unix seconds. */
  expiresAt: number;
  /** A download (`get`) or an upload (`put`) — a token for one is never good for the other. Default `get`. */
  op?: 'get' | 'put';
  /** For `put`: the most bytes the upload may carry. */
  maxBytes?: number;
  filename?: string;
  contentType?: string;
}

/**
 * Signs and verifies the tokens in a local-disk download URL:
 * `base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, payload))`.
 * The token is the whole grant — no session, no lookup — so it is only as
 * good as the secret; `LocalDiskFileStoreModule` refuses one under 32 characters.
 */
export class LocalDiskSigner {
  constructor(private readonly secret: string) {}

  sign(grant: LocalDiskGrant): string {
    const payload = Buffer.from(
      JSON.stringify([
        grant.fileRef,
        grant.expiresAt,
        grant.filename ?? null,
        grant.contentType ?? null,
        grant.op ?? 'get',
        grant.maxBytes ?? null,
      ]),
    ).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  /** The grant, or `null` when the token is malformed, forged, expired, or for the other operation. */
  verify(token: string, op: 'get' | 'put' = 'get', now = Date.now()): LocalDiskGrant | null {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
    const payload = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1), 'base64url');
    const expected = Buffer.from(this.mac(payload), 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!Array.isArray(parsed) || parsed.length !== 6) return null;
      const [fileRef, expiresAt, filename, contentType, tokenOp, maxBytes] = parsed as unknown[];
      if (typeof fileRef !== 'string' || typeof expiresAt !== 'number' || tokenOp !== op) return null;
      if (expiresAt * 1000 <= now) return null;
      return {
        fileRef,
        expiresAt,
        op,
        maxBytes: typeof maxBytes === 'number' ? maxBytes : undefined,
        filename: typeof filename === 'string' ? filename : undefined,
        contentType: typeof contentType === 'string' ? contentType : undefined,
      };
    } catch {
      return null;
    }
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
