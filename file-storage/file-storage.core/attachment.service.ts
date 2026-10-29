import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';
import type { AttachmentStore } from './attachment-store.port';
import type { Attachment } from './attachment.interface';
import { assertFileMatchesCategory, type FileCategoryRegistry, type ResolvedFileCategory, type Retention } from './file-category';
import type { FileAccessRecorder } from './file-access-recorder.port';
import type { FileRecord } from './file-record.interface';
import type { FileScanner } from './file-scanner.port';
import type { FileStorageAuditEmitter } from './file-storage-audit.port';
import type { FileStorageOptions } from './file-storage.options';
import type { FileStore } from './file-store.port';
import { FileValidationError, type FileValidator } from './file-validator.port';
import type {
  FileUploadRejectionEvent,
  FileUploadRejectionReason,
  FileUploadRejectionRecorder,
} from './file-upload-rejection-recorder.port';
import {
  DirectUploadUnsupportedError,
  isDirectUploadFileStore,
  type PendingUpload,
  type PendingUploadStore,
} from './direct-upload.port';
import type { SignedLinkResolver } from './signed-link-resolver.port';
import type { StorageQuotaStore } from './storage-quota.port';
import {
  ATTACHMENT_STORE,
  FILE_ACCESS_RECORDER,
  FILE_CATEGORY_REGISTRY,
  FILE_SCANNER,
  FILE_STORAGE_AUDIT_EMITTER,
  FILE_STORAGE_OPTIONS,
  FILE_STORE,
  FILE_UPLOAD_REJECTION_RECORDER,
  FILE_VALIDATOR,
  PENDING_UPLOAD_STORE,
  SIGNED_LINK_RESOLVER,
  STORAGE_QUOTA_STORE,
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

/** Who tried to upload what — the facts every rejection row carries. */
interface RejectionContext {
  tenantId: string;
  actorId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

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
    @Inject(FILE_UPLOAD_REJECTION_RECORDER) private readonly rejectionRecorder: FileUploadRejectionRecorder,
    @Inject(SIGNED_LINK_RESOLVER) private readonly signedLinks: SignedLinkResolver,
    @Inject(FILE_STORAGE_AUDIT_EMITTER) private readonly audit: FileStorageAuditEmitter,
    @Inject(FILE_STORAGE_OPTIONS) private readonly options: FileStorageOptions,
    @Inject(STORAGE_QUOTA_STORE) private readonly quotas: StorageQuotaStore,
    @Inject(PENDING_UPLOAD_STORE) private readonly pending: PendingUploadStore,
  ) {}

  /**
   * Validate → the tenant's storage limit → scan → upload → persist
   * (FileRecord + first Attachment, one tx). On persistence failure the blob
   * is best-effort deleted. Every refusal is recorded as a rejection.
   */
  async attach(input: UploadInput): Promise<{ fileRecord: FileRecord; attachment: Attachment }> {
    const tenantId = this.requireTenant(input.actor);
    const ctx: RejectionContext = { tenantId, actorId: input.actor.id, ...input.file };
    const category = await this.checkUpload(ctx, input.category, input.file.data);
    const verdict = await this.scan(ctx, category, input.file.data);

    const { fileRef } = await this.fileStore.upload(input.file.data, {
      contentType: input.file.contentType,
      filename: input.file.filename,
      category: category.key,
      tenantId,
      bucket: category.bucket,
    });
    return this.persist({ ctx, category, fileRef, data: input.file.data, verdict, attachedTo: input.attachedTo, actor: input.actor });
  }

  /**
   * Step one of a direct upload — the bytes go to the bucket, not through the
   * API. Everything that can be checked without the bytes is checked now
   * (category, type, extension, size, the tenant's storage limit); the URL
   * expires after `uploadUrlExpirySeconds`. Send the bytes with exactly the
   * returned `headers`, then call `completeUpload`.
   */
  async beginUpload(input: Omit<UploadInput, 'file'> & { file: { contentType: string; filename: string; sizeBytes: number } }): Promise<{
    uploadId: string;
    url: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresAt: Date;
  }> {
    if (!isDirectUploadFileStore(this.fileStore)) throw new DirectUploadUnsupportedError();
    const tenantId = this.requireTenant(input.actor);
    const ctx: RejectionContext = { tenantId, actorId: input.actor.id, ...input.file };
    const category = await this.checkUpload(ctx, input.category);

    const expirySeconds = this.options.uploadUrlExpirySeconds;
    const fileRef = this.fileStore.reserveRef({ tenantId, category: category.key, filename: input.file.filename, bucket: category.bucket });
    const pending = await this.pending.create({
      tenantId,
      actorId: input.actor.id,
      category: category.key,
      attachedToType: input.attachedTo.type,
      attachedToId: input.attachedTo.id,
      filename: input.file.filename,
      contentType: input.file.contentType,
      sizeBytes: input.file.sizeBytes,
      fileRef,
      expiresAt: new Date(Date.now() + expirySeconds * 1000),
    });
    const target = await this.fileStore.createUploadUrl(fileRef, {
      contentType: input.file.contentType,
      sizeBytes: input.file.sizeBytes,
      expirySeconds,
    });
    return { uploadId: pending.id, ...target, expiresAt: pending.expiresAt };
  }

  /**
   * Step two: the object must be there and exactly the declared size; its
   * bytes are read back for the content check, the scan and the hash; the
   * category and the storage limit are checked again (either may have changed
   * since step one). Only the actor who began it can complete it. Any refusal
   * deletes the object and is recorded as a rejection.
   */
  async completeUpload(input: { uploadId: string; actor: Actor }): Promise<{ fileRecord: FileRecord; attachment: Attachment }> {
    if (!isDirectUploadFileStore(this.fileStore)) throw new DirectUploadUnsupportedError();
    const store = this.fileStore;
    const pending = await this.pending.get(input.uploadId);
    if (!pending || pending.actorId !== input.actor.id || pending.tenantId !== input.actor.tenantId) {
      throw new NotFoundException('no such upload');
    }
    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.dropPending(pending);
      throw new GoneException('this upload expired — begin it again');
    }
    const object = await store.stat(pending.fileRef);
    if (!object) throw new ConflictException('nothing has been uploaded to this upload yet');
    // Claim it before the slow part — a second complete for the same upload is a 404, not a second record.
    if (!(await this.pending.delete(pending.id))) throw new NotFoundException('no such upload');

    const ctx: RejectionContext = {
      tenantId: pending.tenantId,
      actorId: pending.actorId,
      filename: pending.filename,
      contentType: pending.contentType,
      sizeBytes: pending.sizeBytes,
    };
    try {
      if (object.sizeBytes !== pending.sizeBytes) {
        throw this.reject(ctx, pending.category, 'validation-failed', `the upload is ${object.sizeBytes} bytes; ${pending.sizeBytes} were declared`);
      }
      const data = await store.read(pending.fileRef);
      const category = await this.checkUpload(ctx, pending.category, data);
      const verdict = await this.scan(ctx, category, data);
      return await this.persist({
        ctx,
        category,
        fileRef: pending.fileRef,
        data,
        verdict,
        attachedTo: { type: pending.attachedToType, id: pending.attachedToId },
        actor: input.actor,
      });
    } catch (e) {
      await this.safeDeleteBlob(pending.fileRef);
      throw e;
    }
  }

  /**
   * Attach an existing FileRecord to another entity — a second Attachment row,
   * no new blob. `category` is resolved like `attach`'s: unknown or inactive
   * for the file's tenant → `ForbiddenException`.
   */
  async link(input: {
    fileRecordId: string;
    attachedTo: { type: string; id: string };
    category: string;
    actor: Actor;
  }): Promise<Attachment> {
    const record = await this.requireFileRecord(input.fileRecordId);
    await this.assertTenantAccess(input.actor, record);
    const category = await this.categories.resolve(record.tenantId, input.category);
    if (!category || !category.active) {
      throw new ForbiddenException(`file category '${input.category}' is not available`);
    }

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

  /**
   * An entity's files, newest first — what a vertical's "documents on this
   * invoice" panel lists. A tenant actor only ever sees their own tenant's
   * files, whatever the entity id; a platform admin sees all.
   */
  async listForEntity(input: {
    attachedTo: { type: string; id: string };
    actor: Actor;
  }): Promise<Array<Attachment & { fileRecord: FileRecord }>> {
    const platform = await this.options.isPlatformAdmin(input.actor);
    if (!platform && input.actor.tenantId === null) return [];
    return this.store.findByEntity(input.attachedTo.type, input.attachedTo.id, {
      tenantId: platform ? undefined : (input.actor.tenantId ?? undefined),
    });
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

  /**
   * Hard-delete: every Attachment + the FileRecord (one tx), then the blob
   * (best-effort — a failed blob delete leaves a reconcilable orphan).
   *
   * Refused (409) while the file is under legal hold — for everyone — and,
   * for anyone but a platform admin, before its `retainUntil`. A platform
   * admin's early delete (an erasure request) is marked `overrodeRetention`
   * in the audit event.
   */
  async deleteFile(input: { fileRecordId: string; actor: Actor }): Promise<void> {
    const record = await this.requireFileRecord(input.fileRecordId);
    await this.assertTenantAccess(input.actor, record);
    if (record.legalHold) {
      throw new ConflictException('this file is under legal hold — release the hold before deleting it');
    }
    const early = record.retainUntil !== null && record.retainUntil.getTime() > Date.now();
    if (early && !(await this.options.isPlatformAdmin(input.actor))) {
      throw new ConflictException(`this file must be kept until ${record.retainUntil!.toISOString()}`);
    }

    const removed = await this.store.deleteFileCascade(record.id);
    if (removed) await this.safeDeleteBlob(removed.fileRef);

    await this.safeEmit({
      kind: 'file.deleted',
      fileRecordId: record.id,
      tenantId: record.tenantId,
      actor: input.actor,
      before: record,
      overrodeRetention: early,
      cause: 'request',
    });
  }

  /** Place a legal hold: nobody deletes the file and retention skips it until it's released. 409 if already held. */
  async placeLegalHold(input: { fileRecordId: string; actor: Actor; reason: string }): Promise<FileRecord> {
    const record = await this.requireFileRecord(input.fileRecordId);
    await this.assertTenantAccess(input.actor, record);
    if (record.legalHold) throw new ConflictException('this file is already under legal hold');
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('a legal hold needs a reason');

    const updated = await this.store.setLegalHold(record.id, { heldAt: new Date(), heldBy: input.actor.id, reason });
    if (!updated) throw new NotFoundException();
    await this.safeEmit({ kind: 'file.hold_placed', fileRecordId: record.id, tenantId: record.tenantId, actor: input.actor, reason });
    return updated;
  }

  /** Release a legal hold. 409 if the file isn't held. */
  async releaseLegalHold(input: { fileRecordId: string; actor: Actor }): Promise<FileRecord> {
    const record = await this.requireFileRecord(input.fileRecordId);
    await this.assertTenantAccess(input.actor, record);
    if (!record.legalHold) throw new ConflictException('this file is not under legal hold');

    const updated = await this.store.setLegalHold(record.id, null);
    if (!updated) throw new NotFoundException();
    await this.safeEmit({
      kind: 'file.hold_released',
      fileRecordId: record.id,
      tenantId: record.tenantId,
      actor: input.actor,
      before: record.legalHold,
    });
    return updated;
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
      filename: record.filename,
      contentType: record.contentType,
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
      filename: record.filename,
      contentType: record.contentType,
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

  private requireTenant(actor: Actor): string {
    if (actor.tenantId === null) throw new BadRequestException('cannot attach a file without a tenant context');
    return actor.tenantId;
  }

  /**
   * Category (active for this tenant), the app-wide rules and the category's
   * — on the bytes too when given — and the tenant's storage limit. Each
   * refusal is recorded and thrown.
   */
  private async checkUpload(ctx: RejectionContext, categoryKey: string, data?: Buffer): Promise<ResolvedFileCategory> {
    const category = await this.categories.resolve(ctx.tenantId, categoryKey);
    if (!category || !category.active) {
      throw this.reject(ctx, categoryKey, 'category-unavailable', `file category '${categoryKey}' is not available`);
    }
    const target = { sizeBytes: ctx.sizeBytes, contentType: ctx.contentType, filename: ctx.filename, data };
    try {
      this.validator.validate(target);
      assertFileMatchesCategory(target, category);
    } catch (e) {
      if (e instanceof FileValidationError) throw this.reject(ctx, category.key, 'validation-failed', e.message);
      throw e;
    }
    const quota = await this.quotas.getQuota(ctx.tenantId);
    if (quota) {
      const used = await this.quotas.usage(ctx.tenantId);
      if (used + ctx.sizeBytes > quota.maxBytes) {
        throw this.reject(
          ctx,
          category.key,
          'quota-exceeded',
          `this tenant's storage is full — ${used} of ${quota.maxBytes} bytes used, and the file is ${ctx.sizeBytes}`,
        );
      }
    }
    return category;
  }

  /** `infected` is always refused; `unscannable` as the category says. */
  private async scan(ctx: RejectionContext, category: ResolvedFileCategory, data: Buffer): Promise<'clean' | 'unscannable'> {
    const verdict = await this.scanner.scan(data, { contentType: ctx.contentType, filename: ctx.filename });
    if (verdict === 'infected') throw this.reject(ctx, category.key, 'scan-rejected', 'file failed the malware scan');
    if (verdict === 'unscannable' && category.onUnscannable === 'reject') {
      throw this.reject(ctx, category.key, 'scan-rejected', 'file could not be scanned and this category rejects unscannable files');
    }
    return verdict;
  }

  /** FileRecord + first Attachment in one tx; the blob is best-effort deleted if that fails. Audited `file.attached`. */
  private async persist(input: {
    ctx: RejectionContext;
    category: ResolvedFileCategory;
    fileRef: string;
    data: Buffer;
    verdict: 'clean' | 'unscannable';
    attachedTo: { type: string; id: string };
    actor: Actor;
  }): Promise<{ fileRecord: FileRecord; attachment: Attachment }> {
    const { ctx, category } = input;
    let result: { fileRecord: FileRecord; attachment: Attachment };
    try {
      result = await this.store.attach({
        fileRecord: {
          tenantId: ctx.tenantId,
          fileRef: input.fileRef,
          category: category.key,
          contentType: ctx.contentType,
          sizeBytes: ctx.sizeBytes,
          contentHash: createHash('sha256').update(input.data).digest('hex'),
          uploadedBy: ctx.actorId,
          filename: cleanFilename(ctx.filename),
          scanVerdict: input.verdict,
          retainUntil: retainUntil(category.retention, new Date()),
        },
        attachment: {
          attachedToType: input.attachedTo.type,
          attachedToId: input.attachedTo.id,
          category: category.key,
        },
      });
    } catch (e) {
      await this.safeDeleteBlob(input.fileRef);
      throw e;
    }
    await this.safeEmit({
      kind: 'file.attached',
      fileRecordId: result.fileRecord.id,
      attachmentId: result.attachment.id,
      tenantId: ctx.tenantId,
      category: category.key,
      actor: input.actor,
    });
    return result;
  }

  /** Records the refusal (best-effort) and returns the HTTP error to throw. */
  private reject(ctx: RejectionContext, category: string, reason: FileUploadRejectionReason, message: string): Error {
    void this.recordRejection({ ...ctx, category, reason, message });
    return reason === 'category-unavailable' ? new ForbiddenException(message) : new UnprocessableEntityException(message);
  }

  private async dropPending(pending: PendingUpload): Promise<boolean> {
    const removed = await this.pending.delete(pending.id);
    if (removed) await this.safeDeleteBlob(pending.fileRef);
    return removed;
  }

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

  private async recordRejection(event: Omit<FileUploadRejectionEvent, 'occurredAt'>): Promise<void> {
    try {
      await this.rejectionRecorder.record({ ...event, occurredAt: new Date() });
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

/** Longest stored filename — the uploader's name for the file, not a storage path. */
const MAX_FILENAME = 255;

/**
 * The uploader's name for the file as it's stored and shown: the last path
 * segment (a browser on Windows may send `C:\\fakepath\\x.pdf`), control
 * characters removed, trimmed, at most 255 characters keeping the extension.
 * `null` when nothing is left. Never a storage key — `buildObjectKey` decides that.
 */
export function cleanFilename(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!clean) return null;
  if (clean.length <= MAX_FILENAME) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 16 ? clean.slice(dot) : '';
  return clean.slice(0, MAX_FILENAME - ext.length) + ext;
}

/** The date a file of this retention may be deleted from — `null` for indefinite. */
export function retainUntil(retention: Retention, from: Date): Date | null {
  if (retention === 'indefinite') return null;
  return new Date(from.getTime() + retention.keepForDays * 86_400_000);
}
