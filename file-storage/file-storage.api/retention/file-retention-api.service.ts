import { ConflictException, ForbiddenException, Inject, Injectable, NotImplementedException } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  FILE_STORAGE_OPTIONS,
  FileRetentionService,
  NotAStrayBlobError,
  StrayBlobListingUnsupportedError,
  type FileStorageOptions,
} from '../../file-storage.core';

const DAY_MS = 86_400_000;

/**
 * Volume & retention: what the retention run is working on, running it now
 * (platform only — it spans every tenant), and purging orphaned files
 * (tenant-scoped for a tenant actor). Deletes are audited by `FileRetentionService`.
 */
@Injectable()
export class FileRetentionApiService {
  constructor(
    @Inject(FileRetentionService) private readonly retention: FileRetentionService,
    @Inject(FILE_STORAGE_OPTIONS) private readonly options: FileStorageOptions,
  ) {}

  async volume(actor: Actor, requestedTenantId?: string) {
    return this.retention.volume(await this.scopeTenant(actor, requestedTenantId));
  }

  async runNow(actor: Actor) {
    await this.requirePlatform(actor, 'a retention run spans every tenant');
    return this.retention.run();
  }

  /** What a purge with these bounds would delete and leave — the console's confirm says it before anything goes. */
  async previewOrphanPurge(actor: Actor, query: { olderThanDays: number; tenantId?: string }) {
    return this.retention.previewOrphanPurge({
      olderThan: new Date(Date.now() - query.olderThanDays * DAY_MS),
      tenantId: await this.scopeTenant(actor, query.tenantId),
    });
  }

  async purgeOrphans(actor: Actor, body: { olderThanDays: number; tenantId?: string }) {
    return this.retention.purgeOrphans({
      actor,
      olderThan: new Date(Date.now() - body.olderThanDays * DAY_MS),
      tenantId: await this.scopeTenant(actor, body.tenantId),
    });
  }

  /** Platform only — a bucket holds every tenant's objects. 501 when the store can't list. */
  async findStrayBlobs(actor: Actor, query: { bucket: string; cursor?: string; limit?: number }) {
    await this.requirePlatform(actor, 'a bucket holds every tenant\'s objects');
    try {
      return await this.retention.findStrayBlobs(query);
    } catch (e) {
      if (e instanceof StrayBlobListingUnsupportedError) throw new NotImplementedException(e.message);
      throw e;
    }
  }

  /** Platform only. 409 when a record holds the blob after all. */
  async deleteStrayBlob(actor: Actor, fileRef: string) {
    await this.requirePlatform(actor, 'a bucket holds every tenant\'s objects');
    try {
      await this.retention.deleteStrayBlob({ fileRef, actor });
    } catch (e) {
      if (e instanceof NotAStrayBlobError) throw new ConflictException(e.message);
      throw e;
    }
  }

  private async requirePlatform(actor: Actor, why: string): Promise<void> {
    if (!(await this.options.isPlatformAdmin(actor))) throw new ForbiddenException(`${why} — platform admins only`);
  }

  private async scopeTenant(actor: Actor, requested: string | undefined): Promise<string | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return requested;
    if (actor.tenantId === null) throw new ForbiddenException('no tenant context');
    if (requested !== undefined && requested !== actor.tenantId) throw new ForbiddenException("cannot act on another tenant's files");
    return actor.tenantId;
  }
}
