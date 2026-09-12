import { DynamicModule, Module } from '@nestjs/common';
import { FILE_STORE_CONFIG, type FileStoreConfig } from '../file-storage.core';
import { SupabaseFileStore } from './supabase-file-store';
import { SUPABASE_CLIENT, SUPABASE_FILE_STORE } from './tokens';

export interface SupabaseFileStoreModuleConfig {
  /** The token the consumer's own Supabase client is already provided under. */
  supabaseClientToken: string | symbol | (new (...args: never[]) => unknown);
  /** Object-key strategy — see `FileStoreConfig`. Plain data, bound via `useValue`. */
  fileStoreConfig: FileStoreConfig;
  /** Whatever module exports the provider behind `supabaseClientToken`. */
  imports?: DynamicModule['imports'];
}

/**
 * Model 1 blob backend. Binds `SupabaseFileStore` under `SUPABASE_FILE_STORE`;
 * point `FileStorageModule.forRoot({ fileStoreToken: SUPABASE_FILE_STORE })`
 * at it and import this in the same `imports` array.
 */
@Module({})
export class SupabaseFileStoreModule {
  static forRoot(config: SupabaseFileStoreModuleConfig): DynamicModule {
    return {
      module: SupabaseFileStoreModule,
      imports: config.imports ?? [],
      providers: [
        { provide: SUPABASE_CLIENT, useExisting: config.supabaseClientToken },
        { provide: FILE_STORE_CONFIG, useValue: config.fileStoreConfig },
        SupabaseFileStore,
        { provide: SUPABASE_FILE_STORE, useExisting: SupabaseFileStore },
      ],
      exports: [SUPABASE_FILE_STORE, FILE_STORE_CONFIG],
    };
  }
}
