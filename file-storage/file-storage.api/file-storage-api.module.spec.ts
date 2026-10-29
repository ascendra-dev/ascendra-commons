import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FileStorageApiModule } from './file-storage-api.module';
import { FileInventoryApiService } from './inventory/file-inventory-api.service';
import { FileCategoryApiService } from './categories/file-category-api.service';
import { FileInventoryController } from './inventory/file-inventory.controller';
import { FILE_STORAGE_API_AUDIT_EMITTER, FILE_STORAGE_API_USER_DIRECTORY } from './tokens';
import { FileCategoryController } from './categories/file-category.controller';
import { FileRetentionController } from './retention/file-retention.controller';
import {
  AttachmentService,
  FileRetentionService,
  FILE_CATEGORY_ADMIN_PORT,
  FILE_STORAGE_OBSERVABILITY_PORT,
  FILE_STORAGE_OPTIONS,
  resolveFileStorageOptions,
} from '../file-storage.core';

@Module({
  providers: [
    { provide: FILE_STORAGE_OBSERVABILITY_PORT, useValue: {} },
    { provide: FILE_CATEGORY_ADMIN_PORT, useValue: {} },
    { provide: AttachmentService, useValue: {} },
    { provide: FileRetentionService, useValue: {} },
    { provide: FILE_STORAGE_OPTIONS, useValue: resolveFileStorageOptions({}) },
  ],
  exports: [FILE_STORAGE_OBSERVABILITY_PORT, FILE_CATEGORY_ADMIN_PORT, AttachmentService, FileRetentionService, FILE_STORAGE_OPTIONS],
})
class FakePortsModule {}

describe('FileStorageApiModule.forRoot', () => {
  it('registers both controllers and services, defaulting audit to the no-op', async () => {
    const ref = await Test.createTestingModule({
      imports: [FileStorageApiModule.forRoot({ imports: [FakePortsModule] })],
    }).compile();

    expect(ref.get(FileInventoryApiService)).toBeInstanceOf(FileInventoryApiService);
    expect(ref.get(FileCategoryApiService)).toBeInstanceOf(FileCategoryApiService);
    expect(ref.get(FileInventoryController)).toBeInstanceOf(FileInventoryController);
    expect(ref.get(FILE_STORAGE_API_AUDIT_EMITTER)).toBeDefined();
    expect(ref.get(FILE_STORAGE_API_USER_DIRECTORY)).toBeNull();
  });

  it('binds a supplied audit emitter token', async () => {
    const EMITTER = Symbol('EMITTER');
    const record = vi.fn();
    @Module({ providers: [{ provide: EMITTER, useValue: { record } }], exports: [EMITTER] })
    class EmitterModule {}

    const ref = await Test.createTestingModule({
      imports: [FileStorageApiModule.forRoot({ auditEmitterToken: EMITTER, imports: [FakePortsModule, EmitterModule] })],
    }).compile();

    (ref.get(FILE_STORAGE_API_AUDIT_EMITTER) as { record: () => void }).record();
    expect(record).toHaveBeenCalled();
  });

  it('registers the catalog controller before the inventory one — else GET files/:id answers GET files/categories', () => {
    expect(FileStorageApiModule.forRoot().controllers).toEqual([FileCategoryController, FileRetentionController, FileInventoryController]);
  });
});
