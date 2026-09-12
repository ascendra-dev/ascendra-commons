import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';
import type { AttachmentStore } from './attachment-store.port';
import type { Attachment } from './attachment.interface';
import { assertFileMatchesCategory, type FileCategoryRegistry } from './file-category';
import type { FileAccessRecorder } from './file-access-recorder.port';
import type { FileRecord } from './file-record.interface';
import type { FileScanner } from './file-scanner.port';
import type { FileStorageAuditEmitter } from './file-storage-audit.port';
import type { FileStorageOptions } from './file-storage.options';
import type { FileStore } from './file-store.port';
import { FileValidationError, type FileValidator } from './file-validator.port';
import type { SignedLinkResolver } from './signed-link-resolver.port';
import {
  ATTACHMENT_STORE,
  FILE_ACCESS_RECORDER,
  FILE_CATEGORY_REGISTRY,
  FILE_SCANNER,
  FILE_STORAGE_AUDIT_EMITTER,
  FILE_STORAGE_OPTIONS,
  FILE_STORE,
  FILE_VALIDATOR,
  SIGNED_LINK_RESOLVER,
} from './tokens';

export interface UploadInput {
  file: { data: Buffer; contentType: string; filename: string; sizeBytes: number };
  /** A `FileCategory` key. Resolved against the tenant's effective catalog; unknown/inactive → `ForbiddenException`. */
  category: string;
  attachedTo: { type: string; id: string };
  /** Already authorized by the caller (the vertical's own controller). Used for `uploadedBy`, tenant isolation and audit. */
  actor: Actor;
}

export type DownloadPurpose = 'in-app' | 'shareable-link';

/**
 * The orchestration handler a vertical's own controllers call. It does **not**
 * do per-entity authorization (that's the controller's job — see
 * `RegistryAttachmentAuthorizer`); it is handed an already-authorized `actor`.
 *
 * It does enforce the **tenant boundary** on every actor-bearing path: with no
 * RLS behind the storage blob, this is the last place "tenant A never reads
 * tenant B's file" can be guaranteed. A platform admin (per
 * `options.isPlatformAdmin`) is exempt; a token download has no actor and is
 * scoped by the token itself.
 */
@Injectable()
export class AttachmentService {
  constructor(
    @Inject(FILE_STORE) private readonly fileStore: FileStore,
    @Inject(ATTACHMENT_STORE) private readonly store: AttachmentStore,
    @Inject(FILE_CATEGORY_REGISTRY) private readonly categories: FileCategoryRegistry,
    @Inject(FILE_VALIDATOR) private readonly validator: FileValidator,
    @Inject(FILE_SCANNER) private readonly scanner: FileScanner,
    @Inject(FILE_ACCESS_RECORDER) private readonly accessRecorder: FileAccessRecorder,
    @Inject(SIGNED_LINK_RESOLVER) private readonly signedLinks: SignedLinkResolver,
    @Inject(FILE_STORAGE_AUDIT_EMITTER) private readonly audit: FileStorageAuditEmitter,
    @Inject(FILE_STORAGE_OPTIONS) private readonly options: FileStorageOptions,
  ) {}

  /** Validate → scan → upload → persist (FileRecord + first Attachment, one tx). On persistence failure the blob is best-effort deleted. */
  async attach(input: UploadInput): Promise<{ fileRecord: FileRecord; attachment: Attachment }> {
    if (input.actor.tenantId === null) {
      throw new BadRequestException('cannot attach a file without a tenant context');
    }
    const tenantId = input.actor.tenantId;

    const category = await this.categories.resolve(tenantId, input.category);
    if (!category || !category.active) {
      throw new ForbiddenException(`file category '${input.category}' is not available`);
    }

    const target = {
      sizeBytes: input.file.sizeBytes,
      contentType: input.file.contentType,
      filename: input.file.filename,
    };
    try {
      this.validator.validate(target);
      assertFileMatchesCategory(target, category);
    } catch (e) {
      if (e instanceof FileValidationError) throw new UnprocessableEntityException(e.message);
      throw e;
    }

    const verdict = await this.scanner.scan(input.file.data, {
      contentType: input.file.contentType,
      filename: input.file.filename,
    });
    if (verdict === 'infected') {
      throw new UnprocessableEntityException('file failed the malware scan');
    }
    if (verdict === 'unscannable' && category.onUnscannable === 'reject') {
      throw new UnprocessableEntityException('file could not be scanned and this category rejects unscannable files');
    }

    const { fileRef } = await this.fileStore.upload(input.file.data, {
      contentType: input.file.contentType,
      filename: input.file.filename,
      category: category.key,
      tenantId,
      bucket: category.bucket,
    });

    let result: { fileRecord: FileRecord; attachment: Attachment };
    try {
      result = await this.store.attach({
        fileRecord: {
          tenantId,
          fileRef,
          category: category.key,
          contentType: input.file.contentType,
          sizeBytes: input.file.sizeBytes,
          contentHash: createHash('sha256').update(input.file.data).digest('hex'),
          uploadedBy: input.actor.id,
        },
        attachment: {
          attachedToType: input.attachedTo.type,
          attachedToId: input.attachedTo.id,
          category: category.key,
        },
      });
    } catch (e) {
      await this.safeDeleteBlob(fileRef);
      throw e;
    }

    await this.safeEmit({
      kind: 'file.attached',
      fileRecordId: result.fileRecord.id,
      attachmentId: result.attachment.id,
      tenantId,
      category: category.key,
      actor: input.actor,
    });
    return result;
  }

  /** Attach an existing FileRecord to another entity — a second Attachment row, no new blob. */
  async link(input: {
    fileRecordId: string;
    attachedTo: { type: string; id: string };
    category: string;
    actor: Actor;
  }): Promise<Attachment> {
    const record = await this.requireFileRecord(input.fileRecordId);
    await this.assertTenantAccess(input.actor, record);

    const attachment = await this.store.link({
      fileRecordId: record.id,
      attachment: {
        attachedToType: input.attachedTo.type,
        attachedToId: input.attachedTo.id,
        category: input.category,
      },
    });

    await this.safeEmit({
      kind: 'file.linked',
      fileRecordId: record.id,
      attachmentId: attachment.id,
      tenantId: record.tenantId,
      category: input.category,
      actor: input.actor,
    });
    return attachment;
  }

  /** Remove one association. The FileRecord (and blob) are retained. */
  async detach(input: { attachmentId: string; actor: Actor }): Promise<void> {
    const attachment = await this.store.getAttachmentById(input.attachmentId);
    if (!attachment) throw new NotFoundException();
    const record = await this.requireFileRecord(attachment.fileRecordId);
    await this.assertTenantAccess(input.actor, record);

    await this.store.detach(input.attachmentId);

    await this.safeEmit({
      kind: 'file.detached',
      attachmentId: input.attachmentId,
      fileRecordId: record.id,
      tenantId: record.tenantId,
      actor: input.actor,
    });
  }

  /** Hard-delete: every Attachment + the FileRecord (one tx), then the blob (best-effort — a failed blob delete leaves a reconcilable orphan). */
  async deleteFile(input: { fileRecordId: string; actor: Actor }): Promise<void> {
    const record = await this.requireFileRecord(input.fileRecordId);
    await this.assertTenantAccess(input.actor, record);

    const removed = await this.store.deleteFileCascade(record.id);
    if (removed) await this.safeDeleteBlob(removed.fileRef);

    await this.safeEmit({
      kind: 'file.deleted',
      fileRecordId: record.id,
      tenantId: record.tenantId,
      actor: input.actor,
    });
  }

  /** A short-lived download URL for an authenticated actor. Enforces the tenant boundary. */
  async getDownloadUrl(input: {
    fileRecordId: string;
    actor: Actor;
    purpose: DownloadPurpose;
  }): Promise<string> {
    const record = await this.requireFileRecord(input.fileRecordId);
    await this.assertTenantAccess(input.actor, record);

    const url = await this.fileStore.getUrl(record.fileRef, {
      expirySeconds: await this.resolveExpiry(record, input.purpose),
    });

    void this.recordAccess({
      fileRecordId: record.id,
      tenantId: record.tenantId,
      actorId: input.actor.id,
      via: 'actor',
      purpose: input.purpose,
    });
    return url;
  }

  /** A download URL from an opaque share token. No actor, no tenant check — the token is the grant. */
  async getDownloadUrlByToken(input: { token: string; purpose?: 'shareable-link' }): Promise<string> {
    const ref = await this.signedLinks.resolve(input.token);
    if (!ref) throw new ForbiddenException('invalid or expired link');
    const record = await this.requireFileRecord(ref.fileRecordId);

    const url = await this.fileStore.getUrl(record.fileRef, {
      expirySeconds: await this.resolveExpiry(record, 'shareable-link'),
    });

    void this.recordAccess({
      fileRecordId: record.id,
      tenantId: record.tenantId,
      actorId: null,
      via: 'signed-link',
      purpose: input.purpose ?? 'shareable-link',
    });
    return url;
  }

  /* ─── internals ─────────────────────────────────────────────────────── */

  private async requireFileRecord(id: string): Promise<FileRecord> {
    const record = await this.store.getFileRecordById(id);
    if (!record) throw new NotFoundException();
    return record;
  }

  private async assertTenantAccess(actor: Actor, record: FileRecord): Promise<void> {
    if (await this.options.isPlatformAdmin(actor)) return;
    if (record.tenantId !== actor.tenantId) throw new ForbiddenException();
  }

  private async resolveExpiry(record: FileRecord, purpose: DownloadPurpose): Promise<number> {
    if (purpose === 'in-app') return this.options.downloadUrlExpiry.inApp;
    const category = await this.categories.resolve(record.tenantId, record.category);
    return category?.signedLinkExpirySeconds ?? this.options.downloadUrlExpiry.shareableLink;
  }

  private async recordAccess(event: Omit<Parameters<FileAccessRecorder['record']>[0], 'occurredAt'>): Promise<void> {
    try {
      await this.accessRecorder.record({ ...event, occurredAt: new Date() });
    } catch {
      /* best-effort */
    }
  }

  private async safeDeleteBlob(fileRef: string): Promise<void> {
    try {
      await this.fileStore.delete(fileRef);
    } catch {
      /* best-effort — orphan reconciliation covers this */
    }
  }

  private async safeEmit(event: Parameters<FileStorageAuditEmitter['emit']>[0]): Promise<void> {
    try {
      await this.audit.emit(event);
    } catch {
      /* best-effort */
    }
  }
}
