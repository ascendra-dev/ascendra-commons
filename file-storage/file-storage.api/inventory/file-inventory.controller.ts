import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { FILE_STORAGE_ACTIONS } from '../file-storage-api.options';
import { FILE_REJECTION_REASONS } from '../dto/file-storage-api.dto';
import {
  cursorList,
  cursorParam,
  dateParam,
  enumParam,
  flagParam,
  idParam,
  intParam,
  objectParam,
  knownKeys,
  textParam,
  uuidParam,
} from '../shared/params';
import { FileInventoryApiService } from './file-inventory-api.service';

const MAX_LIMIT = 200;
const MAX_WINDOW_DAYS = 366;
const MAX_SIZE = Number.MAX_SAFE_INTEGER;

/**
 * The ops / compliance file-inventory screen. Reads gated `file.view`; opening
 * content `file.view_content`; deletes `file.delete`; legal holds `file.hold`
 * — all tenant-scoped in the service. Requires `AuthorizationGuard` wired
 * globally as `APP_GUARD`, and fails closed without it (`AuthorizationEnforcedGuard`).
 * Lists answer api-contract.md Rule 4's `{ data, meta: { nextCursor } }`.
 *
 * This is **not** the per-entity upload/view/download surface — that stays in
 * the vertical's own controllers (see `RegistryAttachmentAuthorizer`).
 */
@Controller('files')
@UseGuards(AuthorizationEnforcedGuard)
export class FileInventoryController {
  constructor(@Inject(FileInventoryApiService) private readonly service: FileInventoryApiService) {}

  @Get()
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  async list(
    @CurrentActor() actor: Actor,
    @Query('tenantId') tenantId?: string,
    @Query('category') category?: string,
    @Query('uploadedBy') uploadedBy?: string,
    @Query('uploadedAfter') uploadedAfter?: string,
    @Query('uploadedBefore') uploadedBefore?: string,
    @Query('minSizeBytes') minSizeBytes?: string,
    @Query('held') held?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const page = await this.service.listFiles(actor, {
      tenantId: idParam('tenantId', tenantId, true),
      category: idParam('category', category, true),
      uploadedBy: idParam('uploadedBy', uploadedBy, true),
      uploadedAfter: dateParam('uploadedAfter', uploadedAfter),
      uploadedBefore: dateParam('uploadedBefore', uploadedBefore),
      minSizeBytes: intParam('minSizeBytes', minSizeBytes, 0, MAX_SIZE),
      held: held === undefined || held === '' ? undefined : flagParam('held', held),
      search: textParam('search', search || undefined, 200),
      limit: intParam('limit', limit, 1, MAX_LIMIT),
      cursor: cursorParam(cursor),
    });
    return cursorList(page.rows, page.nextCursor ?? undefined);
  }

  @Get('storage-usage')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  async storageUsage(@CurrentActor() actor: Actor, @Query('tenantId') tenantId?: string) {
    return { data: await this.service.storageUsage(actor, { tenantId: idParam('tenantId', tenantId, true) }) };
  }

  @Get('orphans')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  async orphans(
    @CurrentActor() actor: Actor,
    @Query('tenantId') tenantId?: string,
    @Query('olderThan') olderThan?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const page = await this.service.listOrphans(actor, {
      tenantId: idParam('tenantId', tenantId, true),
      olderThan: dateParam('olderThan', olderThan),
      limit: intParam('limit', limit, 1, MAX_LIMIT),
      cursor: cursorParam(cursor),
    });
    return cursorList(page.rows, page.nextCursor ?? undefined);
  }

  @Get('stats')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  stats(@CurrentActor() actor: Actor, @Query('tenantId') tenantId?: string, @Query('windowDays') windowDays?: string) {
    return this.service.stats(actor, {
      tenantId: idParam('tenantId', tenantId, true),
      windowDays: intParam('windowDays', windowDays, 1, MAX_WINDOW_DAYS),
    });
  }

  @Get('rejections')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  async rejections(
    @CurrentActor() actor: Actor,
    @Query('tenantId') tenantId?: string,
    @Query('category') category?: string,
    @Query('reason') reason?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const page = await this.service.listRejections(actor, {
      tenantId: idParam('tenantId', tenantId, true),
      category: idParam('category', category, true),
      reason: enumParam('reason', reason, FILE_REJECTION_REASONS),
      limit: intParam('limit', limit, 1, MAX_LIMIT),
      cursor: cursorParam(cursor),
    });
    return cursorList(page.rows, page.nextCursor ?? undefined);
  }

  @Get(':id')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  getOne(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.getFile(actor, uuidParam('id', id));
  }

  /** The file's content — a short-lived URL. Its own action; every one is audited and access-logged. */
  @Post(':id/download-url')
  @HttpCode(200)
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW_CONTENT)
  downloadUrl(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.issueDownloadUrl(actor, uuidParam('id', id));
  }

  @Get(':id/access-log')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  async accessLog(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const page = await this.service.getAccessLog(actor, uuidParam('id', id), {
      limit: intParam('limit', limit, 1, MAX_LIMIT),
      cursor: cursorParam(cursor),
    });
    return cursorList(page.rows, page.nextCursor ?? undefined);
  }

  /** 409 while the file is held, or — for a tenant actor — before its retention date. */
  @Delete(':id')
  @HttpCode(204)
  @RequiresAction(FILE_STORAGE_ACTIONS.DELETE)
  deleteFile(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.deleteFile(actor, uuidParam('id', id));
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(204)
  @RequiresAction(FILE_STORAGE_ACTIONS.DELETE)
  detach(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    return this.service.detach(actor, uuidParam('id', id), uuidParam('attachmentId', attachmentId));
  }

  /** Body `{ reason }`. 409 when already held. */
  @Put(':id/hold')
  @RequiresAction(FILE_STORAGE_ACTIONS.HOLD)
  placeHold(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const obj = objectParam('body', body ?? {});
    knownKeys('the body', obj, ['reason']);
    const reason = textParam('reason', obj.reason, 500);
    if (!reason?.trim()) throw new BadRequestException('"reason" is required — say why the file is held');
    return this.service.placeLegalHold(actor, uuidParam('id', id), reason);
  }

  /** 409 when not held. */
  @Delete(':id/hold')
  @RequiresAction(FILE_STORAGE_ACTIONS.HOLD)
  releaseHold(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.releaseLegalHold(actor, uuidParam('id', id));
  }
}
