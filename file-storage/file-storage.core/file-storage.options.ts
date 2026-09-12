import type { Actor } from '../../authorization/authorization.core';

export interface DownloadUrlExpiry {
  /** Expiry for a `purpose: 'in-app'` download URL, in seconds. Default 300. */
  inApp: number;
  /** Default expiry for a `purpose: 'shareable-link'` URL, in seconds — a category's `signedLinkExpirySeconds` overrides it. Default 3600. */
  shareableLink: number;
}

/** The shape bound under `FILE_STORAGE_OPTIONS`. */
export interface FileStorageOptions {
  /**
   * Is this actor a platform admin — exempt from the tenant-isolation check on
   * downloads/mutations, sees every tenant's files in `file-storage.api`?
   * Default: `actor.tenantId === null`.
   */
  isPlatformAdmin: (actor: Actor) => boolean | Promise<boolean>;
  downloadUrlExpiry: DownloadUrlExpiry;
}

export function resolveFileStorageOptions(config: {
  isPlatformAdmin?: (actor: Actor) => boolean | Promise<boolean>;
  downloadUrlExpiry?: Partial<DownloadUrlExpiry>;
}): FileStorageOptions {
  return {
    isPlatformAdmin: config.isPlatformAdmin ?? ((actor) => actor.tenantId === null),
    downloadUrlExpiry: {
      inApp: config.downloadUrlExpiry?.inApp ?? 300,
      shareableLink: config.downloadUrlExpiry?.shareableLink ?? 3600,
    },
  };
}
