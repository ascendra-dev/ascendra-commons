import { Controller, Delete, Get, HttpCode, Inject, Param, Query } from '@nestjs/common';
import { CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { FILE_STORAGE_ACTIONS } from '../file-storage-api.options';
import { FileInventoryApiService } from './file-inventory-api.service';

/**
 * The ops / compliance file-inventory screen. Reads gated `file.view`,
 * deletes gated `file.delete`; both tenant-scoped in the service. Requires
 * `AuthorizationGuard` wired globally as `APP_GUARD` (see `authorization.core`).
 *
 * This is **not** the per-entity upload/view/download surface — that stays in
 * the vertical's own controllers (see `RegistryAttachmentAuthorizer`).
 */
@Controller('files')
export class FileInventoryController {
  constructor(@Inject(FileInventoryApiService) private readonly service: FileInventoryApiService) {}

  @Get()
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  list(
    @CurrentActor() actor: Actor,
    @Query('tenantId') tenantId?: string,
    @Query('category') category?: string,
    @Query('uploadedBy') uploadedBy?: string,
    @Query('uploadedAfter') uploadedAfter?: string,
    @Query('uploadedBefore') uploadedBefore?: string,
    @Query('minSizeBytes') minSizeBytes?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listFiles(actor, {
      tenantId,
      category,
      uploadedBy,
      uploadedAfter,
      uploadedBefore,
      minSizeBytes: minSizeBytes !== undefined ? Number(minSizeBytes) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('storage-usage')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  storageUsage(@CurrentActor() actor: Actor, @Query('tenantId') tenantId?: string) {
    return this.service.storageUsage(actor, { tenantId });
  }

  @Get('orphans')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  orphans(
    @CurrentActor() actor: Actor,
    @Query('tenantId') tenantId?: string,
    @Query('olderThan') olderThan?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listOrphans(actor, {
      tenantId,
      olderThan,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get(':id')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  getOne(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.getFile(actor, id);
  }

  @Get(':id/access-log')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  accessLog(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.getAccessLog(actor, id, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequiresAction(FILE_STORAGE_ACTIONS.DELETE)
  deleteFile(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.deleteFile(actor, id);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(204)
  @RequiresAction(FILE_STORAGE_ACTIONS.DELETE)
  detach(@CurrentActor() actor: Actor, @Param('attachmentId') attachmentId: string) {
    return this.service.detach(actor, attachmentId);
  }
}
