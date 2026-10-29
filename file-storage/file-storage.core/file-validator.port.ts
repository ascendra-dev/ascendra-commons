import { checkContentSignature } from './content-signature';

/**
 * The **app-global** upload gate: a hard size ceiling and a MIME/extension
 * denylist that apply to every upload regardless of category. A per-category
 * rule (see `FileCategory`) can only be *more* restrictive than this; it can
 * never widen the app to accept something the denylist blocks.
 *
 * A port so a consumer can swap in richer global logic (magic-byte sniffing,
 * an entropy check). `RuleBasedFileValidator` is the default, built from
 * `FileValidationDefaults` passed to `FileStorageModule.forRoot`.
 */
export interface FileValidator {
  /** Throws `FileValidationError` if the file breaks an app-global rule. */
  validate(target: FileValidationTarget): void;
}

export interface FileValidationTarget {
  sizeBytes: number;
  contentType: string;
  filename: string;
  /** The bytes, when the validator should look at them (`AttachmentService` always passes them). */
  data?: Buffer;
}

export interface FileValidationDefaults {
  /** Upper bound on any single upload, in bytes. Omit for no global ceiling (a category's `maxSizeBytes` still applies). */
  absoluteMaxSizeBytes?: number;
  /** Content types never accepted, whatever the category says (e.g. `application/x-msdownload`). Case-insensitive. */
  deniedContentTypes?: string[];
  /** Extensions never accepted, with or without the leading dot (e.g. `exe`, `.sh`). Case-insensitive. */
  deniedExtensions?: string[];
  /**
   * Check the bytes against the declared type (`checkContentSignature`): a
   * "PDF" that doesn't start `%PDF-`, or a native executable declared as a
   * document or image, is refused. Default `true`.
   */
  verifyContentSignature?: boolean;
}

/** Thrown by a `FileValidator` and by `assertFileMatchesCategory`. `AttachmentService` maps it to a 422. */
export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileValidationError';
  }
}

/** Lowercased extension without the leading dot, or `null` if the filename has none. */
export function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

function normalizeExt(ext: string): string {
  return ext.replace(/^\./, '').toLowerCase();
}

export class RuleBasedFileValidator implements FileValidator {
  private readonly deniedContentTypes: Set<string>;
  private readonly deniedExtensions: Set<string>;

  constructor(private readonly defaults: FileValidationDefaults = {}) {
    this.deniedContentTypes = new Set((defaults.deniedContentTypes ?? []).map((t) => t.toLowerCase()));
    this.deniedExtensions = new Set((defaults.deniedExtensions ?? []).map(normalizeExt));
  }

  validate(target: FileValidationTarget): void {
    if (
      this.defaults.absoluteMaxSizeBytes !== undefined &&
      target.sizeBytes > this.defaults.absoluteMaxSizeBytes
    ) {
      throw new FileValidationError(
        `file is ${target.sizeBytes} bytes; the app-wide limit is ${this.defaults.absoluteMaxSizeBytes}`,
      );
    }
    if (this.deniedContentTypes.has(target.contentType.toLowerCase())) {
      throw new FileValidationError(`content type '${target.contentType}' is not allowed`);
    }
    const ext = extensionOf(target.filename);
    if (ext && this.deniedExtensions.has(ext)) {
      throw new FileValidationError(`file extension '.${ext}' is not allowed`);
    }
    if (target.data && this.defaults.verifyContentSignature !== false) {
      const verdict = checkContentSignature(target.data, target.contentType);
      if (!verdict.ok) {
        throw new FileValidationError(
          verdict.reason === 'executable'
            ? `the file is a program, not '${target.contentType}'`
            : `the file's content is not '${target.contentType}' — it doesn't start the way one does`,
        );
      }
    }
  }
}
