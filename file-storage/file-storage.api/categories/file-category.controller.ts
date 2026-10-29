import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { FILE_STORAGE_ACTIONS } from '../file-storage-api.options';
import { UPSERT_CATEGORY_OVERRIDE_FIELDS, type UpsertCategoryOverrideBody } from '../dto/file-storage-api.dto';
import { bodyIntParam, booleanParam, enumParam, idParam, knownKeys, objectParam, stringListParam } from '../shared/params';
import { FileCategoryApiService } from './file-category-api.service';

/**
 * The file-category catalog. `GET` gated `file.view`; `PATCH`/`DELETE` gated
 * `file.category.manage` and tenant-scoped in the service. There is no `POST` —
 * base category definitions come only from the deploy-time seed. Fails closed
 * without the global `AuthorizationGuard` (`AuthorizationEnforcedGuard`).
 */
@Controller('files/categories')
@UseGuards(AuthorizationEnforcedGuard)
export class FileCategoryController {
  constructor(@Inject(FileCategoryApiService) private readonly service: FileCategoryApiService) {}

  @Get()
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  async list(@CurrentActor() actor: Actor, @Query('tenantId') tenantId?: string) {
    return { data: await this.service.listCategories(actor, idParam('tenantId', tenantId, true)) };
  }

  @Get(':key')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  getOne(@CurrentActor() actor: Actor, @Param('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.service.getCategory(actor, idParam('key', key), idParam('tenantId', tenantId, true));
  }

  @Patch(':key')
  @RequiresAction(FILE_STORAGE_ACTIONS.MANAGE_CATEGORY)
  upsert(@CurrentActor() actor: Actor, @Param('key') key: string, @Body() body: unknown) {
    return this.service.upsertOverride(actor, idParam('key', key), parseOverrideBody(body));
  }

  @Delete(':key')
  @HttpCode(204)
  @RequiresAction(FILE_STORAGE_ACTIONS.MANAGE_CATEGORY)
  deactivate(@CurrentActor() actor: Actor, @Param('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.service.deactivate(actor, idParam('key', key), idParam('tenantId', tenantId, true));
  }
}

/** Every field typed, unknown fields refused — a 400 naming the field, never a 500 from the driver. */
export function parseOverrideBody(body: unknown): UpsertCategoryOverrideBody {
  const obj = objectParam('the body', body ?? {});
  knownKeys('the body', obj, UPSERT_CATEGORY_OVERRIDE_FIELDS);
  const out: UpsertCategoryOverrideBody = {};
  if (obj.tenantId !== undefined) out.tenantId = idParam('tenantId', obj.tenantId);
  if (obj.allowedContentTypes !== undefined) out.allowedContentTypes = stringListParam('allowedContentTypes', obj.allowedContentTypes);
  if (obj.allowedExtensions !== undefined) out.allowedExtensions = stringListParam('allowedExtensions', obj.allowedExtensions);
  if (obj.maxSizeBytes !== undefined) out.maxSizeBytes = bodyIntParam('maxSizeBytes', obj.maxSizeBytes, 1);
  if (obj.minSizeBytes !== undefined) out.minSizeBytes = bodyIntParam('minSizeBytes', obj.minSizeBytes, 1);
  if (obj.signedLinkExpirySeconds !== undefined) {
    out.signedLinkExpirySeconds = bodyIntParam('signedLinkExpirySeconds', obj.signedLinkExpirySeconds, 1);
  }
  if (obj.onUnscannable !== undefined) {
    out.onUnscannable = obj.onUnscannable === null ? null : enumParam('onUnscannable', obj.onUnscannable, ['reject', 'allow'] as const);
  }
  if (obj.active !== undefined) out.active = booleanParam('active', obj.active);
  return out;
}
