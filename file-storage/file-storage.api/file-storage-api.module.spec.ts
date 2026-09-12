import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FileStorageApiModule } from './file-storage-api.module';
import { FileInventoryApiService } from './inventory/file-inventory-api.service';
import { FileCategoryApiService } from './categories/file-category-api.service';
import { FileInventoryController } from './inventory/file-inventory.controller';
import { FILE_STORAGE_API_AUDIT_EMITTER } from './tokens';
import {
  AttachmentService,
  FILE_CATEGORY_ADMIN_PORT,
  FILE_STORAGE_OBSERVABILITY_PORT,
} from '../file-storage.core';

@Module({
  providers: [
    { provide: FILE_STORAGE_OBSERVABILITY_PORT, useValue: {} },
    { provide: FILE_CATEGORY_ADMIN_PORT, useValue: {} },
    { provide: AttachmentService, useValue: {} },
  ],
  exports: [FILE_STORAGE_OBSERVABILITY_PORT, FILE_CATEGORY_ADMIN_PORT, AttachmentService],
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
});
