import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Query } from '@nestjs/common';
import { CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { FILE_STORAGE_ACTIONS } from '../file-storage-api.options';
import { FileCategoryApiService } from './file-category-api.service';
import type { UpsertCategoryOverrideBody } from '../dto/file-storage-api.dto';

/**
 * The file-category catalog. `GET` gated `file.view`; `PATCH`/`DELETE` gated
 * `file.category.manage` and tenant-scoped in the service. There is no `POST` —
 * base category definitions come only from the deploy-time seed.
 */
@Controller('files/categories')
export class FileCategoryController {
  constructor(@Inject(FileCategoryApiService) private readonly service: FileCategoryApiService) {}

  @Get()
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  list(@CurrentActor() actor: Actor, @Query('tenantId') tenantId?: string) {
    return this.service.listCategories(actor, tenantId);
  }

  @Get(':key')
  @RequiresAction(FILE_STORAGE_ACTIONS.VIEW)
  getOne(@CurrentActor() actor: Actor, @Param('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.service.getCategory(actor, key, tenantId);
  }

  @Patch(':key')
  @RequiresAction(FILE_STORAGE_ACTIONS.MANAGE_CATEGORY)
  upsert(@CurrentActor() actor: Actor, @Param('key') key: string, @Body() body: UpsertCategoryOverrideBody) {
    return this.service.upsertOverride(actor, key, body ?? {});
  }

  @Delete(':key')
  @HttpCode(204)
  @RequiresAction(FILE_STORAGE_ACTIONS.MANAGE_CATEGORY)
  deactivate(@CurrentActor() actor: Actor, @Param('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.service.deactivate(actor, key, tenantId);
  }
}
