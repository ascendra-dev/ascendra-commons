/**
 * Turns an opaque share token into the `fileRecordId` it grants access to.
 * The vertical application owns token issuance and validation entirely
 * (signing, expiry, single-use, revocation) — `file-storage` only asks
 * "what file does this token point at, if it's valid?" and gets `null` when
 * it isn't.
 *
 * `AttachmentService.getDownloadUrlByToken` runs no tenant-isolation check on
 * the result — the token itself is the scoped grant.
 */
export interface SignedLinkResolver {
  resolve(token: string): Promise<{ fileRecordId: string } | null>;
}

export class MissingSignedLinkResolverError extends Error {
  constructor() {
    super(
      'No SignedLinkResolver is bound. Token-based downloads require the consumer to bind one via ' +
        'FileStorageModule.forRoot({ signedLinkResolverToken }).',
    );
    this.name = 'MissingSignedLinkResolverError';
  }
}

/** The default — token downloads throw until the consumer binds a real resolver. */
export class MissingSignedLinkResolver implements SignedLinkResolver {
  async resolve(): Promise<never> {
    throw new MissingSignedLinkResolverError();
  }
}
