import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  AttachmentService,
  FILE_STORAGE_OBSERVABILITY_PORT,
  type FileStorageObservabilityPort,
} from '../../file-storage.core';
import { FILE_STORAGE_API_AUDIT_EMITTER, FILE_STORAGE_API_OPTIONS } from '../tokens';
import type { FileStorageApiAuditEmitter } from '../file-storage-audit.port';
import type { FileStorageApiOptions } from '../file-storage-api.options';
import type {
  AccessLogQueryDto,
  FileInventoryQueryDto,
  OrphanQueryDto,
  StorageUsageQueryDto,
} from '../dto/file-storage-api.dto';

/**
 * The ops / compliance file-inventory surface. Reads go through
 * `FileStorageObservabilityPort`, tenant-scoped for a non-platform actor. The
 * two destructive operations delegate to `AttachmentService` (which re-checks
 * the tenant boundary and emits its own `.core` audit event) and additionally
 * record a `file-storage.api` audit event here.
 */
@Injectable()
export class FileInventoryApiService {
  constructor(
    @Inject(FILE_STORAGE_OBSERVABILITY_PORT) private readonly port: FileStorageObservabilityPort,
    @Inject(AttachmentService) private readonly attachments: AttachmentService,
    @Inject(FILE_STORAGE_API_OPTIONS) private readonly options: FileStorageApiOptions,
    @Inject(FILE_STORAGE_API_AUDIT_EMITTER) private readonly audit: FileStorageApiAuditEmitter,
  ) {}

  async listFiles(actor: Actor, query: FileInventoryQueryDto) {
    return this.port.listFiles({
      tenantId: await this.scopeTenant(actor, query.tenantId),
      category: query.category,
      uploadedBy: query.uploadedBy,
      uploadedAfter: query.uploadedAfter ? new Date(query.uploadedAfter) : undefined,
      uploadedBefore: query.uploadedBefore ? new Date(query.uploadedBefore) : undefined,
      minSizeBytes: query.minSizeBytes,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  async getFile(actor: Actor, id: string) {
    const detail = await this.port.getFile(id);
    if (!detail) throw new NotFoundException();
    await this.assertCanSee(actor, detail.fileRecord.tenantId);
    const url = await this.attachments.getDownloadUrl({ fileRecordId: id, actor, purpose: 'in-app' });
    return { ...detail, url };
  }

  async getAccessLog(actor: Actor, id: string, query: AccessLogQueryDto) {
    const detail = await this.port.getFile(id);
    if (!detail) throw new NotFoundException();
    await this.assertCanSee(actor, detail.fileRecord.tenantId);
    return this.port.getAccessLog(id, { limit: query.limit, cursor: query.cursor });
  }

  async storageUsage(actor: Actor, query: StorageUsageQueryDto) {
    return this.port.storageUsage({ tenantId: await this.scopeTenant(actor, query.tenantId) });
  }

  async listOrphans(actor: Actor, query: OrphanQueryDto) {
    return this.port.listOrphanedFileRecords({
      tenantId: await this.scopeTenant(actor, query.tenantId),
      olderThan: query.olderThan ? new Date(query.olderThan) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  async deleteFile(actor: Actor, id: string): Promise<void> {
    await this.attachments.deleteFile({ fileRecordId: id, actor });
    await this.audit.record({
      action: 'file.deleted',
      actorId: actor.id,
      tenantId: actor.tenantId,
      entityType: 'file',
      entityId: id,
    });
  }

  async detach(actor: Actor, attachmentId: string): Promise<void> {
    await this.attachments.detach({ attachmentId, actor });
    await this.audit.record({
      action: 'attachment.detached',
      actorId: actor.id,
      tenantId: actor.tenantId,
      entityType: 'attachment',
      entityId: attachmentId,
    });
  }

  /** For a platform admin, honour the requested tenant filter (or none); otherwise force the actor's own tenant. */
  private async scopeTenant(actor: Actor, requested: string | undefined): Promise<string | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return requested;
    return actor.tenantId ?? undefined;
  }

  private async assertCanSee(actor: Actor, tenantId: string): Promise<void> {
    if (await this.options.isPlatformAdmin(actor)) return;
    if (tenantId !== actor.tenantId) throw new ForbiddenException();
  }
}
