import { extensionOf, FileValidationError } from './file-validator.port';

/**
 * A declared upload type — "KYC identity document", "invoice supporting doc" —
 * with the rules for what a valid file of that type is. The catalog of these
 * is the single centralized place an operator sees every upload type the app
 * accepts and its constraints.
 *
 * Base definitions are **developer-controlled** — seeded at deploy time, never
 * created through an admin screen. A tenant admin may *tighten* the tunable
 * fields for their own tenant (a per-tenant override row); they can never
 * loosen them past the base or the app-global `FileValidator`.
 */
export interface FileCategory {
  /** Stable identifier stored on every `FileRecord`/`Attachment` — e.g. `kyc.identity-document`. */
  key: string;
  /** Human label for the admin UI. */
  label: string;
  description?: string;
  /** Which storage bucket files of this category live in. Base-only — infra, not a tenant concern. */
  bucket: string;
  /** Accepted content types. Empty = accept any (still subject to the app-global denylist). */
  allowedContentTypes: string[];
  maxSizeBytes: number;
  /** Reject files smaller than this — catches truncated/0-byte uploads. Default 1. */
  minSizeBytes?: number;
  /** Accepted extensions (belt-and-braces with `allowedContentTypes`). Omit to not check extension. */
  allowedExtensions?: string[];
  /** What to do when the scanner returns `unscannable` for a file of this category. */
  onUnscannable: 'reject' | 'allow';
  /** Expiry for a shareable-link download of this category, in seconds. Omit for the module default. */
  signedLinkExpirySeconds?: number;
  /** Declared retention intent. Nothing enforces it yet — lifecycle tooling will read it. */
  retention: Retention;
}

export interface RetentionPolicy {
  keepForDays: number;
}
export type Retention = RetentionPolicy | 'indefinite';

/** A `FileCategory` after base + per-tenant override have been merged — the rules actually enforced for one tenant. */
export interface ResolvedFileCategory {
  key: string;
  label: string;
  description?: string;
  bucket: string;
  allowedContentTypes: string[];
  maxSizeBytes: number;
  minSizeBytes: number;
  allowedExtensions?: string[];
  onUnscannable: 'reject' | 'allow';
  signedLinkExpirySeconds?: number;
  retention: Retention;
  /** `false` when the base is soft-deleted or the tenant deactivated it for themselves — uploads are rejected. */
  active: boolean;
}

/**
 * The database-backed catalog. Bound under `FILE_CATEGORY_REGISTRY`.
 *
 * `resolve` returns the effective rules for `(tenantId, key)` — at most a base
 * row and one tenant override, merged. `null` when no base row exists.
 */
export interface FileCategoryRegistry {
  resolve(tenantId: string | null, key: string): Promise<ResolvedFileCategory | null>;
  list(tenantId: string | null): Promise<ResolvedFileCategory[]>;
}

/**
 * Per-category upload check — content type, extension, size band. Throws
 * `FileValidationError`; `AttachmentService` maps it to a 422. Pure, so a
 * caller can run it standalone.
 */
export function assertFileMatchesCategory(
  file: { sizeBytes: number; contentType: string; filename: string },
  category: ResolvedFileCategory,
): void {
  if (
    category.allowedContentTypes.length > 0 &&
    !category.allowedContentTypes.map((t) => t.toLowerCase()).includes(file.contentType.toLowerCase())
  ) {
    throw new FileValidationError(
      `content type '${file.contentType}' is not accepted for category '${category.key}'`,
    );
  }

  if (category.allowedExtensions && category.allowedExtensions.length > 0) {
    const ext = extensionOf(file.filename);
    const allowed = category.allowedExtensions.map((e) => e.replace(/^\./, '').toLowerCase());
    if (!ext || !allowed.includes(ext)) {
      throw new FileValidationError(
        `file extension '${ext ? `.${ext}` : '(none)'}' is not accepted for category '${category.key}'`,
      );
    }
  }

  if (file.sizeBytes > category.maxSizeBytes) {
    throw new FileValidationError(
      `file is ${file.sizeBytes} bytes; category '${category.key}' allows at most ${category.maxSizeBytes}`,
    );
  }
  if (file.sizeBytes < category.minSizeBytes) {
    throw new FileValidationError(
      `file is ${file.sizeBytes} bytes; category '${category.key}' requires at least ${category.minSizeBytes}`,
    );
  }
}
