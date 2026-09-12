import { DynamicModule, Module, Provider } from '@nestjs/common';
import { DefaultTenantScopeResolver } from './tenant-scope-resolver';
import { TenantContext } from './tenant-context.service';
import { TENANT_SCOPE_RESOLVER } from './tokens';

type OverrideToken = string | symbol | (new (...args: never[]) => unknown);

export interface MultiTenancyModuleConfig {
  /**
   * The consumer's own `TenantScopeResolver` token, for a project with a
   * third, identity-scoped persona (not bound to a fixed tenant, but not an
   * unrestricted admin bypass either — a `payer`, most concretely). Omit to
   * use `DefaultTenantScopeResolver` (tenant-bound vs. admin, the common
   * two-persona case).
   */
  scopeResolverToken?: OverrideToken;
  /** Whatever module(s) export the provider behind `scopeResolverToken`. */
  imports?: DynamicModule['imports'];
}

/**
 * Provides `TenantContext` (request-scoped) and the scope resolver (default
 * or the consumer's). Does not provide or own the database connection
 * itself — every repository calls `tenantContext.run(this.db, fn)` with
 * whatever `TransactionalDb` the project already has.
 */
@Module({})
export class MultiTenancyModule {
  static forRoot(config: MultiTenancyModuleConfig = {}): DynamicModule {
    const resolverProvider: Provider = config.scopeResolverToken
      ? { provide: TENANT_SCOPE_RESOLVER, useExisting: config.scopeResolverToken }
      : { provide: TENANT_SCOPE_RESOLVER, useClass: DefaultTenantScopeResolver };

    return {
      module: MultiTenancyModule,
      imports: config.imports ?? [],
      providers: [resolverProvider, TenantContext],
      exports: [TenantContext],
    };
  }
}
