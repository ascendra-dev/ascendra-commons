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
   * 'permission-table' — Model 2, not implemented yet: PermissionTableAuthorizer
   * throws on every call. The option exists so the seam is real now; see
   * permission-table-authorizer.ts.
   */
  model?: AuthorizationModel;
  /**
   * persona -> allowed actions, or '*' for unrestricted. Required for (and only
   * read by) model: 'static-persona-map'. See StaticRoleMapAuthorizer.
   */
  personaActions?: Record<string, string[] | '*'>;
}

/**
 * A dynamic module — same reasoning as NotificationModule.forRoot(): the
 * 'static-persona-map' model requires config because there's no sensible default
 * persona/action map.
 *
 * `forRoot({ model })` selects which Authorizer implementation is bound to
 * AUTHORIZER — 'static-persona-map' now, 'permission-table' once a real need for
 * named roles/delegation appears. Call sites inject AUTHORIZER and are unaffected
 * by which implementation is bound; that is exactly what can()'s async signature
 * was chosen to make painless.
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
      return {
        module: AuthorizationModule,
        providers: [
          PermissionTableAuthorizer,
          { provide: AUTHORIZER, useExisting: PermissionTableAuthorizer },
          AuthorizationGuard,
        ],
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
