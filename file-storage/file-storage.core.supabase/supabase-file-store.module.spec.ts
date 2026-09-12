import { describe, expect, it } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SupabaseFileStoreModule } from './supabase-file-store.module';
import { SupabaseFileStore } from './supabase-file-store';
import { SUPABASE_FILE_STORE } from './tokens';
import { FILE_STORE_CONFIG } from '../file-storage.core';

const CLIENT = Symbol('CLIENT');

@Module({
  providers: [{ provide: CLIENT, useValue: { storage: { from: () => ({}) } } }],
  exports: [CLIENT],
})
class ClientModule {}

describe('SupabaseFileStoreModule.forRoot', () => {
  it('binds SupabaseFileStore under SUPABASE_FILE_STORE and exports FILE_STORE_CONFIG', async () => {
    const ref = await Test.createTestingModule({
      imports: [
        SupabaseFileStoreModule.forRoot({
          supabaseClientToken: CLIENT,
          fileStoreConfig: { buildObjectKey: (m) => m.filename },
          imports: [ClientModule],
        }),
      ],
    }).compile();

    expect(ref.get(SUPABASE_FILE_STORE)).toBeInstanceOf(SupabaseFileStore);
    expect(ref.get(FILE_STORE_CONFIG)).toBeDefined();
  });
});
