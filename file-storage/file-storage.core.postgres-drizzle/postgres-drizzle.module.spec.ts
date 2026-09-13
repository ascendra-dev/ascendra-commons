import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresAttachmentStoreModule } from './attachment-store/postgres-attachment-store.module';
import { PostgresFileCategoryModule } from './category-registry/postgres-file-category.module';
import { PostgresFileStorageAdminModule } from './access-log/postgres-file-storage-admin.module';
import {
  POSTGRES_ATTACHMENT_STORE,
  POSTGRES_FILE_ACCESS_RECORDER,
  POSTGRES_FILE_CATEGORY_REGISTRY,
  POSTGRES_FILE_UPLOAD_REJECTION_RECORDER,
} from './tokens';
import { FILE_CATEGORY_ADMIN_PORT, FILE_STORAGE_OBSERVABILITY_PORT } from '../file-storage.core';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('file-storage.core.postgres-drizzle modules', () => {
  it('PostgresAttachmentStoreModule binds the store', async () => {
    const { DbModule } = dbModule();
    const ref = await Test.createTestingModule({
      imports: [PostgresAttachmentStoreModule.forRoot({ sqlExecutorToken: DB, imports: [DbModule] })],
    }).compile();
    expect(ref.get(POSTGRES_ATTACHMENT_STORE)).toBeDefined();
  });

  it('PostgresFileCategoryModule binds registry + admin port and runs the seed on boot', async () => {
    const { DbModule, execute } = dbModule();
    const ref = await Test.createTestingModule({
      imports: [
        PostgresFileCategoryModule.forRoot({
          sqlExecutorToken: DB,
          imports: [DbModule],
          seedCategories: [
            { key: 'k', label: 'K', bucket: 'b', allowedContentTypes: [], maxSizeBytes: 1, onUnscannable: 'reject', retention: 'indefinite' },
          ],
        }),
      ],
    }).compile();
    await ref.init();

    expect(ref.get(POSTGRES_FILE_CATEGORY_REGISTRY)).toBeDefined();
    expect(ref.get(FILE_CATEGORY_ADMIN_PORT)).toBeDefined();
    const seeded = execute.mock.calls
      .map((c) => dialect.sqlToQuery(c[0] as SQL).sql)
      .some((s) => /insert into commons_file_category/i.test(s));
    expect(seeded).toBe(true);
  });

  it('PostgresFileStorageAdminModule binds the recorders + observability port', async () => {
    const { DbModule } = dbModule();
    const ref = await Test.createTestingModule({
      imports: [PostgresFileStorageAdminModule.forRoot({ sqlExecutorToken: DB, imports: [DbModule] })],
    }).compile();
    expect(ref.get(POSTGRES_FILE_ACCESS_RECORDER)).toBeDefined();
    expect(ref.get(POSTGRES_FILE_UPLOAD_REJECTION_RECORDER)).toBeDefined();
    expect(ref.get(FILE_STORAGE_OBSERVABILITY_PORT)).toBeDefined();
  });
});
