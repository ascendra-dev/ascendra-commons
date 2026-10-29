import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { FILE_STORAGE_ACTIONS } from '../file-storage-api.options';
import { bodyIntParam, idParam, knownKeys, objectParam } from '../shared/params';
import { FileQuotaApiService } from './file-quota-api.service';

/**
 * Per-tenant storage limits. `GET` gated `file.view`; `PUT` / `DELETE` gated
 * `file.quota.manage` and platform-only in the service. Registered before
 * `FileInventoryController` — `files/quotas` must not be taken for a file id.
 */
@Controller('files/quotas')
@UseGuards(AuthorizationEnforcedGuard)
export class FileQuotaController {
  constructor(@Inject(FileQuotaApiService) private readonly service: FileQuotaApiService) {}

  @Get()
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  async list(@CurrentActor() actor: Actor, @Query('tenantId') tenantId?: string) {
    return { data: await this.service.list(actor, idParam('tenantId', tenantId, true)) };
  }

  /** Body `{ maxBytes }` — a whole number of bytes, at least 1. */
  @Put(':tenantId')
  @RequiresAction(FILE_STORAGE_ACTIONS.MANAGE_QUOTA)
  set(@CurrentActor() actor: Actor, @Param('tenantId') tenantId: string, @Body() body: unknown) {
    const obj = objectParam('the body', body ?? {});
    knownKeys('the body', obj, ['maxBytes']);
    const maxBytes = bodyIntParam('maxBytes', obj.maxBytes, 1);
    if (maxBytes == null) throw new BadRequestException('"maxBytes" is required — a whole number of bytes, at least 1');
    return this.service.set(actor, idParam('tenantId', tenantId), maxBytes);
  }

  /** 404 when the tenant has no limit. */
  @Delete(':tenantId')
  @HttpCode(204)
  @RequiresAction(FILE_STORAGE_ACTIONS.MANAGE_QUOTA)
  clear(@CurrentActor() actor: Actor, @Param('tenantId') tenantId: string) {
    return this.service.clear(actor, idParam('tenantId', tenantId));
  }
}
