import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  AttachmentService,
  FILE_STORAGE_OBSERVABILITY_PORT,
  FILE_STORAGE_OPTIONS,
  InvalidFileCursorError,
  type FileDetail,
  type FileStorageObservabilityPort,
  type FileStorageOptions,
} from '../../file-storage.core';
import { FILE_STORAGE_API_AUDIT_EMITTER } from '../tokens';
import type { FileStorageApiAuditEmitter } from '../file-storage-audit.port';
import type {
  AccessLogQueryDto,
  FileInventoryQueryDto,
  FileRejectionQueryDto,
  FileStatsQueryDto,
  OrphanQueryDto,
  StorageUsageQueryDto,
} from '../dto/file-storage-api.dto';

/**
 * The ops / compliance file-inventory surface. Reads go through
 * `FileStorageObservabilityPort`, tenant-scoped for a non-platform actor.
 * Opening a file's content, deleting, detaching and legal holds go through
 * `AttachmentService`, which re-checks the tenant boundary and emits the
 * `.core` audit event — so this service doesn't audit those a second time.
 * The one event it records itself is a content view (`file.content_viewed`).
 */
@Injectable()
export class FileInventoryApiService {
  constructor(
    @Inject(FILE_STORAGE_OBSERVABILITY_PORT) private readonly port: FileStorageObservabilityPort,
    @Inject(AttachmentService) private readonly attachments: AttachmentService,
    @Inject(FILE_STORAGE_OPTIONS) private readonly options: FileStorageOptions,
    @Inject(FILE_STORAGE_API_AUDIT_EMITTER) private readonly audit: FileStorageApiAuditEmitter,
  ) {}

  async listFiles(actor: Actor, query: FileInventoryQueryDto) {
    return this.read(async () => this.port.listFiles({ ...query, tenantId: await this.scopeTenant(actor, query.tenantId) }));
  }

  /** One file's record and attachments — metadata only. Its content is `issueDownloadUrl`, a separate action. */
  async getFile(actor: Actor, id: string): Promise<FileDetail> {
    return this.requireVisible(actor, id);
  }

  /**
   * A short-lived in-app download URL — opening the content, not just the
   * record. `AttachmentService` writes the access-log row; this records a
   * `file.content_viewed` audit event against the file's tenant.
   */
  async issueDownloadUrl(actor: Actor, id: string): Promise<{ url: string; expiresAt: Date }> {
    const detail = await this.requireVisible(actor, id);
    const url = await this.attachments.getDownloadUrl({ fileRecordId: id, actor, purpose: 'in-app' });
    await this.audit.record({
      action: 'file.content_viewed',
      actorId: actor.id,
      tenantId: detail.fileRecord.tenantId,
      entityType: 'file',
      entityId: id,
    });
    return { url, expiresAt: new Date(Date.now() + this.options.downloadUrlExpiry.inApp * 1000) };
  }

  async getAccessLog(actor: Actor, id: string, query: AccessLogQueryDto) {
    await this.requireVisible(actor, id);
    return this.read(() => this.port.getAccessLog(id, query));
  }

  async storageUsage(actor: Actor, query: StorageUsageQueryDto) {
    return this.port.storageUsage({ tenantId: await this.scopeTenant(actor, query.tenantId) });
  }

  async listOrphans(actor: Actor, query: OrphanQueryDto) {
    return this.read(async () =>
      this.port.listOrphanedFileRecords({ ...query, tenantId: await this.scopeTenant(actor, query.tenantId) }),
    );
  }

  async stats(actor: Actor, query: FileStatsQueryDto) {
    return this.port.statsSummary({ ...query, tenantId: await this.scopeTenant(actor, query.tenantId) });
  }

  async listRejections(actor: Actor, query: FileRejectionQueryDto) {
    return this.read(async () =>
      this.port.listRejections({ ...query, tenantId: await this.scopeTenant(actor, query.tenantId) }),
    );
  }

  /** 409 while held or (for a tenant actor) inside retention — see `AttachmentService.deleteFile`. */
  async deleteFile(actor: Actor, id: string): Promise<void> {
    await this.attachments.deleteFile({ fileRecordId: id, actor });
  }

  /** The attachment must belong to this file — `/files/A/attachments/<B's attachment>` is a 404, not a detach of B's. */
  async detach(actor: Actor, fileId: string, attachmentId: string): Promise<void> {
    const detail = await this.requireVisible(actor, fileId);
    if (!detail.attachments.some((a) => a.id === attachmentId)) throw new NotFoundException('no such attachment on this file');
    await this.attachments.detach({ attachmentId, actor });
  }

  async placeLegalHold(actor: Actor, id: string, reason: string) {
    return this.attachments.placeLegalHold({ fileRecordId: id, actor, reason });
  }

  async releaseLegalHold(actor: Actor, id: string) {
    return this.attachments.releaseLegalHold({ fileRecordId: id, actor });
  }

  /** For a platform admin, honour the requested tenant filter (or none); otherwise force the actor's own tenant. */
  private async scopeTenant(actor: Actor, requested: string | undefined): Promise<string | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return requested;
    if (actor.tenantId === null) throw new ForbiddenException('no tenant context');
    return actor.tenantId;
  }

  /** 404 for an unknown file, 403 for another tenant's. */
  private async requireVisible(actor: Actor, id: string): Promise<FileDetail> {
    const detail = await this.port.getFile(id);
    if (!detail) throw new NotFoundException();
    if (!(await this.options.isPlatformAdmin(actor)) && detail.fileRecord.tenantId !== actor.tenantId) {
      throw new ForbiddenException();
    }
    return detail;
  }

  /** A cursor the adapter couldn't decode is the caller's mistake — 400. */
  private async read<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof InvalidFileCursorError) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
