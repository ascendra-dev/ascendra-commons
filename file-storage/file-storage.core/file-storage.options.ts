import type { Actor } from '../../authorization/authorization.core';

export interface DownloadUrlExpiry {
  /** Expiry for a `purpose: 'in-app'` download URL, in seconds. Default 300. */
  inApp: number;
  /** Default expiry for a `purpose: 'shareable-link'` URL, in seconds — a category's `signedLinkExpirySeconds` overrides it. Default 3600. */
  shareableLink: number;
}

/** How long the logs are kept — the retention run deletes older rows. */
export interface LogRetention {
  /** Access-log rows ("who downloaded this"). Default 365 days. */
  accessLogDays: number;
  /** Rejected-upload rows — they carry the uploader's filenames. Default 90 days. */
  rejectionLogDays: number;
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
  logRetention: LogRetention;
  /** How long a direct-upload URL (`beginUpload`) stays valid, in seconds. Default 900. */
  uploadUrlExpirySeconds: number;
}

export function resolveFileStorageOptions(config: {
  isPlatformAdmin?: (actor: Actor) => boolean | Promise<boolean>;
  downloadUrlExpiry?: Partial<DownloadUrlExpiry>;
  logRetention?: Partial<LogRetention>;
  uploadUrlExpirySeconds?: number;
}): FileStorageOptions {
  const days = (name: string, value: number | undefined, fallback: number) => {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`FileStorageModule: logRetention.${name} must be a whole number of days, at least 1`);
    return value;
  };
  const uploadUrlExpirySeconds = config.uploadUrlExpirySeconds ?? 900;
  if (!Number.isSafeInteger(uploadUrlExpirySeconds) || uploadUrlExpirySeconds < 60 || uploadUrlExpirySeconds > 86_400) {
    throw new Error('FileStorageModule: uploadUrlExpirySeconds must be a whole number of seconds from 60 to 86400');
  }
  return {
    uploadUrlExpirySeconds,
    logRetention: {
      accessLogDays: days('accessLogDays', config.logRetention?.accessLogDays, 365),
      rejectionLogDays: days('rejectionLogDays', config.logRetention?.rejectionLogDays, 90),
    },
    isPlatformAdmin: config.isPlatformAdmin ?? ((actor) => actor.tenantId === null),
    downloadUrlExpiry: {
      inApp: config.downloadUrlExpiry?.inApp ?? 300,
      shareableLink: config.downloadUrlExpiry?.shareableLink ?? 3600,
    },
  };
}
