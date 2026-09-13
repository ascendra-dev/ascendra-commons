import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';
import { AttachmentService } from './attachment.service';
import { RegistryAttachmentAuthorizer } from './attachment-authorizer';
import type { EntityAccessChecker } from './entity-access-checker.interface';
import { NoopFileAccessRecorder } from './file-access-recorder.port';
import { NoopFileScanner } from './file-scanner.port';
import { NoopFileStorageAuditEmitter } from './file-storage-audit.port';
import {
  resolveFileStorageOptions,
  type DownloadUrlExpiry,
} from './file-storage.options';
import { RuleBasedFileValidator, type FileValidationDefaults } from './file-validator.port';
import { NoopFileUploadRejectionRecorder } from './file-upload-rejection-recorder.port';
import { MissingSignedLinkResolver } from './signed-link-resolver.port';
import {
  ATTACHMENT_STORE,
  ENTITY_ACCESS_CHECKERS,
  FILE_ACCESS_RECORDER,
  FILE_CATEGORY_REGISTRY,
  FILE_SCANNER,
  FILE_STORAGE_AUDIT_EMITTER,
  FILE_STORAGE_OPTIONS,
  FILE_STORE,
  FILE_UPLOAD_REJECTION_RECORDER,
  FILE_VALIDATOR,
  SIGNED_LINK_RESOLVER,
} from './tokens';

type OverrideToken = string | symbol | (new (...args: never[]) => unknown);

export interface FileStorageModuleConfig {
  /** Token a `FileStore` is provided under — `SUPABASE_FILE_STORE` (Model 1), `S3_FILE_STORE` (Model 2 stub), or your own. Required. */
  fileStoreToken: OverrideToken;
  /** Token an `AttachmentStore` is provided under — `file-storage.core.postgres-drizzle`, or your own. Required. */
  attachmentStoreToken: OverrideToken;
  /** Token a `FileCategoryRegistry` is provided under — `file-storage.core.postgres-drizzle`'s `PostgresFileCategoryRegistry`, or your own. Required. */
  fileCategoryRegistryToken: OverrideToken;

  /** App-global `FileValidator`. Omit → a `RuleBasedFileValidator` built from `validationDefaults`. */
  fileValidatorToken?: OverrideToken;
  /** Feeds the default `RuleBasedFileValidator` (hard size ceiling, MIME/extension denylist). Ignored when `fileValidatorToken` is set. */
  validationDefaults?: FileValidationDefaults;

  /** `FileScanner`. Omit → `NoopFileScanner` (every file `clean`). */
  fileScannerToken?: OverrideToken;
  /** `FileAccessRecorder`. Omit → `NoopFileAccessRecorder`. */
  fileAccessRecorderToken?: OverrideToken;
  /** `FileUploadRejectionRecorder`. Omit → `NoopFileUploadRejectionRecorder`. */
  fileUploadRejectionRecorderToken?: OverrideToken;
  /** `SignedLinkResolver`. Omit → `MissingSignedLinkResolver` (token downloads throw). */
  signedLinkResolverToken?: OverrideToken;
  /** `FileStorageAuditEmitter` for attach/link/detach/delete. Omit → `NoopFileStorageAuditEmitter`. */
  auditEmitterToken?: OverrideToken;

  /** Platform-admin predicate — exempt from tenant isolation. Default `actor.tenantId === null`. */
  isPlatformAdmin?: (actor: Actor) => boolean | Promise<boolean>;
  /** Download-URL expiry defaults (seconds). Default `{ inApp: 300, shareableLink: 3600 }`. */
  downloadUrlExpiry?: Partial<DownloadUrlExpiry>;

  /** For `RegistryAttachmentAuthorizer` (a tool the vertical's own controllers use). Omit → `{}`. */
  entityAccessCheckers?: Record<string, EntityAccessChecker>;

  /**
   * Modules exporting the providers behind the three required tokens, plus —
   * if the vertical uses `RegistryAttachmentAuthorizer` — its own
   * `AuthorizationModule.forRoot()` (which exports `AUTHORIZER`). `useExisting`
   * only resolves a token this module can already see in its providers/imports.
   */
  imports?: DynamicModule['imports'];
}

/**
 * The backend-agnostic core. `forRoot()` is pure token wiring — it binds the
 * three required tokens, defaults the five optional hooks, resolves options,
 * and provides `AttachmentService` (the orchestration handler verticals call)
 * and `RegistryAttachmentAuthorizer` (a tool for their own controllers).
 *
 * Ships no `FileStore`, no `AttachmentStore`, no `FileCategoryRegistry`.
 */
@Module({})
export class FileStorageModule {
  static forRoot(config: FileStorageModuleConfig): DynamicModule {
    const missing = (['fileStoreToken', 'attachmentStoreToken', 'fileCategoryRegistryToken'] as const).filter(
      (k) => !config?.[k],
    );
    if (missing.length > 0) {
      throw new Error(
        `FileStorageModule.forRoot() requires ${missing.join(', ')} — ` +
          'a FileStore backend (file-storage.core.supabase / .s3), file-storage.core.postgres-drizzle ' +
          '(AttachmentStore + FileCategoryRegistry), or your own.',
      );
    }

    const optional = (
      token: symbol,
      configured: OverrideToken | undefined,
      fallback: Type<unknown>,
    ): Provider =>
      configured
        ? { provide: token, useExisting: configured }
        : { provide: token, useClass: fallback };

    return {
      module: FileStorageModule,
      imports: config.imports ?? [],
      providers: [
        { provide: FILE_STORE, useExisting: config.fileStoreToken },
        { provide: ATTACHMENT_STORE, useExisting: config.attachmentStoreToken },
        { provide: FILE_CATEGORY_REGISTRY, useExisting: config.fileCategoryRegistryToken },

        config.fileValidatorToken
          ? { provide: FILE_VALIDATOR, useExisting: config.fileValidatorToken }
          : { provide: FILE_VALIDATOR, useValue: new RuleBasedFileValidator(config.validationDefaults ?? {}) },

        optional(FILE_SCANNER, config.fileScannerToken, NoopFileScanner),
        optional(FILE_ACCESS_RECORDER, config.fileAccessRecorderToken, NoopFileAccessRecorder),
        optional(FILE_UPLOAD_REJECTION_RECORDER, config.fileUploadRejectionRecorderToken, NoopFileUploadRejectionRecorder),
        optional(SIGNED_LINK_RESOLVER, config.signedLinkResolverToken, MissingSignedLinkResolver),
        optional(FILE_STORAGE_AUDIT_EMITTER, config.auditEmitterToken, NoopFileStorageAuditEmitter),

        {
          provide: FILE_STORAGE_OPTIONS,
          useValue: resolveFileStorageOptions({
            isPlatformAdmin: config.isPlatformAdmin,
            downloadUrlExpiry: config.downloadUrlExpiry,
          }),
        },
        { provide: ENTITY_ACCESS_CHECKERS, useValue: config.entityAccessCheckers ?? {} },

        AttachmentService,
        RegistryAttachmentAuthorizer,
      ],
      exports: [
        FILE_STORE,
        ATTACHMENT_STORE,
        FILE_CATEGORY_REGISTRY,
        AttachmentService,
        RegistryAttachmentAuthorizer,
      ],
    };
  }
}
