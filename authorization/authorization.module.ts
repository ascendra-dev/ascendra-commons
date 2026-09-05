import { DynamicModule, Module } from '@nestjs/common';
import { StaticRoleMapAuthorizer } from './authorizer';
import { PermissionTableAuthorizer } from './permission-table-authorizer';
import { AuthorizationGuard } from './authorization.guard';
import { AUTHORIZER, PERSONA_ACTIONS_DATA } from './tokens';

/** Which Authorizer implementation backs AUTHORIZER. Defaults to 'static-persona-map' (Model 1). */
export type AuthorizationModel = 'static-persona-map' | 'permission-table';

export interface AuthorizationModuleConfig {
  /**
   * 'static-persona-map' (default) — StaticRoleMapAuthorizer, Model 1: a
   * constant persona -> actions object, resolved by an in-memory lookup.
   * Requires `personaActions`.
   * 'permission-table' — Model 2: a database-backed authorizer. Pass
   * `authorizerToken` (+ `imports`) pointing at an implementation — the
   * postgres-drizzle adapter's `POSTGRES_PERMISSION_TABLE_AUTHORIZER`, or your
   * own. With no `authorizerToken`, `PermissionTableAuthorizer` (a stub that
   * throws on every call) is bound instead, so "Model 2 selected but not wired"
   * fails loudly rather than silently.
   */
  model?: AuthorizationModel;
  /**
   * persona -> allowed actions, or '*' for unrestricted. Required for (and only
   * read by) model: 'static-persona-map'. See StaticRoleMapAuthorizer.
   */
  personaActions?: Record<string, string[] | '*'>;
  /**
   * model: 'permission-table' only — the injection token an `Authorizer`
   * implementation is already provided under. `useExisting`-aliased to
   * AUTHORIZER. Omit to bind the throwing stub.
   */
  authorizerToken?: string | symbol | (new (...args: never[]) => unknown);
  /**
   * Whatever module(s) export the provider behind `authorizerToken`.
   * `useExisting` only resolves a token NestJS can already see in *this*
   * module's own providers or imports — not the wider application graph.
   */
  imports?: DynamicModule['imports'];
}

/**
 * A dynamic module — same reasoning as NotificationModule.forRoot(): the
 * 'static-persona-map' model requires config because there's no sensible default
 * persona/action map.
 *
 * `forRoot({ model })` selects which Authorizer implementation is bound to
 * AUTHORIZER. Call sites inject AUTHORIZER and are unaffected by which
 * implementation is bound; that is exactly what can()'s async signature was
 * chosen to make painless. Switching models is: flip `model`, add/remove the
 * adapter `imports`, and (one time) run the adapter's seed helper.
 *
 * Does not apply AuthorizationGuard globally — it's provided and exported so the
 * consuming project decides how to wire it: globally via APP_GUARD, or
 * per-controller/per-route via @UseGuards(AuthorizationGuard). See this module's
 * README.
 */
@Module({})
export class AuthorizationModule {
  static forRoot(config: AuthorizationModuleConfig = {}): DynamicModule {
    const model = config.model ?? 'static-persona-map';

    if (model === 'permission-table') {
      const providers = config.authorizerToken
        ? [{ provide: AUTHORIZER, useExisting: config.authorizerToken }, AuthorizationGuard]
        : [PermissionTableAuthorizer, { provide: AUTHORIZER, useExisting: PermissionTableAuthorizer }, AuthorizationGuard];
      return {
        module: AuthorizationModule,
        imports: config.imports ?? [],
        providers,
        exports: [AUTHORIZER, AuthorizationGuard],
      };
    }

    if (!config.personaActions) {
      throw new Error(
        "AuthorizationModule.forRoot({ model: 'static-persona-map' }) requires personaActions — " +
          'a persona -> actions map, or omit model entirely and pass it. See StaticRoleMapAuthorizer.',
      );
    }

    return {
      module: AuthorizationModule,
      providers: [
        { provide: PERSONA_ACTIONS_DATA, useValue: config.personaActions },
        StaticRoleMapAuthorizer,
        { provide: AUTHORIZER, useExisting: StaticRoleMapAuthorizer },
        AuthorizationGuard,
      ],
      exports: [AUTHORIZER, AuthorizationGuard],
    };
  }
}
