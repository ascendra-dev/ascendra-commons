import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import { FILE_STORAGE_OPTIONS, FileRetentionService, type FileStorageOptions } from '../../file-storage.core';

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
    if (!(await this.options.isPlatformAdmin(actor))) {
      throw new ForbiddenException('a retention run spans every tenant — platform admins only');
    }
    return this.retention.run();
  }

  async purgeOrphans(actor: Actor, body: { olderThanDays: number; tenantId?: string }) {
    return this.retention.purgeOrphans({
      actor,
      olderThan: new Date(Date.now() - body.olderThanDays * DAY_MS),
      tenantId: await this.scopeTenant(actor, body.tenantId),
    });
  }

  private async scopeTenant(actor: Actor, requested: string | undefined): Promise<string | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return requested;
    if (actor.tenantId === null) throw new ForbiddenException('no tenant context');
    if (requested !== undefined && requested !== actor.tenantId) throw new ForbiddenException("cannot act on another tenant's files");
    return actor.tenantId;
  }
}
