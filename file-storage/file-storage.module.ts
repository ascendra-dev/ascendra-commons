import { DynamicModule, Module } from '@nestjs/common';
import { SupabaseFileStore } from './supabase-file-store';
import { RegistryAttachmentAuthorizer } from './attachment-authorizer';
import type { FileStoreConfig } from './file-store-config';
import type { EntityAccessChecker } from './entity-access-checker.interface';
import { ATTACHMENT_STORE, ENTITY_ACCESS_CHECKERS, FILE_STORE, FILE_STORE_CONFIG, SUPABASE_CLIENT } from './tokens';

export interface FileStorageModuleConfig {
  /** The injection token the consumer's own Supabase client is already provided under. */
  supabaseClientToken: string | symbol | (new (...args: never[]) => unknown);
  /** Bucket/key strategy — see FileStoreConfig. Plain data, bound via useValue, the same reasoning AuthorizationModule uses for personaActions. */
  fileStoreConfig: FileStoreConfig;
  /** One EntityAccessChecker per entity type the consuming project has — see RegistryAttachmentAuthorizer. */
  entityAccessCheckers: Record<string, EntityAccessChecker>;
  /** The injection token the consumer's own FileRecord/Attachment persistence implementation is already provided under. */
  attachmentStoreToken: string | symbol | (new (...args: never[]) => unknown);
  /**
   * Whatever module(s) export the providers behind supabaseClientToken and
   * attachmentStoreToken, plus — critically — wherever the consumer's own
   * already-configured AuthorizationModule.forRoot() lives, since
   * RegistryAttachmentAuthorizer depends on AUTHORIZER. useExisting (and
   * plain cross-module injection generally) only resolves a token NestJS
   * can already see in *this* module's own providers or imports — not
   * anywhere in the wider application graph.
   */
  imports?: DynamicModule['imports'];
}

/**
 * A dynamic module — requires config because there's no default for which
 * providers are the consumer's Supabase client and persistence layer, and
 * no default entity-access-checker registry (every consuming project's
 * entity types are its own).
 */
@Module({})
export class FileStorageModule {
  static forRoot(config: FileStorageModuleConfig): DynamicModule {
    return {
      module: FileStorageModule,
      imports: config.imports ?? [],
      providers: [
        { provide: SUPABASE_CLIENT, useExisting: config.supabaseClientToken },
        { provide: FILE_STORE_CONFIG, useValue: config.fileStoreConfig },
        { provide: ENTITY_ACCESS_CHECKERS, useValue: config.entityAccessCheckers },
        { provide: ATTACHMENT_STORE, useExisting: config.attachmentStoreToken },
        SupabaseFileStore,
        { provide: FILE_STORE, useExisting: SupabaseFileStore },
        RegistryAttachmentAuthorizer,
      ],
      exports: [FILE_STORE, ATTACHMENT_STORE, RegistryAttachmentAuthorizer],
    };
  }
}
