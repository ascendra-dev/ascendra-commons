import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { FILE_STORAGE_ACTIONS } from '../file-storage-api.options';
import { bodyIntParam, idParam, knownKeys, objectParam } from '../shared/params';
import { FileRetentionApiService } from './file-retention-api.service';

const MAX_ORPHAN_DAYS = 3650;

/**
 * Volume & retention. `GET` gated `file.view`; running retention and purging
 * orphans gated `file.delete`. Registered before `FileInventoryController` —
 * `files/retention` must not be taken for a file id.
 */
@Controller('files')
@UseGuards(AuthorizationEnforcedGuard)
export class FileRetentionController {
  constructor(@Inject(FileRetentionApiService) private readonly service: FileRetentionApiService) {}

  @Get('retention')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  volume(@CurrentActor() actor: Actor, @Query('tenantId') tenantId?: string) {
    return this.service.volume(actor, idParam('tenantId', tenantId, true));
  }

  /** One retention pass now — the same as the scheduled one. Platform admins only. */
  @Post('retention/run')
  @HttpCode(200)
  @RequiresAction(FILE_STORAGE_ACTIONS.DELETE)
  run(@CurrentActor() actor: Actor) {
    return this.service.runNow(actor);
  }

  /** Body `{ olderThanDays, tenantId? }` — files with no attachment, older than that; held or retained files stay. */
  @Post('orphans/purge')
  @HttpCode(200)
  @RequiresAction(FILE_STORAGE_ACTIONS.DELETE)
  purgeOrphans(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const obj = objectParam('the body', body ?? {});
    knownKeys('the body', obj, ['olderThanDays', 'tenantId']);
    const olderThanDays = bodyIntParam('olderThanDays', obj.olderThanDays, 1);
    if (olderThanDays == null || olderThanDays > MAX_ORPHAN_DAYS) {
      throw new BadRequestException(`"olderThanDays" is required — a whole number from 1 to ${MAX_ORPHAN_DAYS}`);
    }
    return this.service.purgeOrphans(actor, { olderThanDays, tenantId: idParam('tenantId', obj.tenantId, true) });
  }
}
