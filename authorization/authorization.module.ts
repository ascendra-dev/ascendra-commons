import { DynamicModule, Module } from '@nestjs/common';
import { StaticRoleMapAuthorizer } from './authorizer';
import { AuthorizationGuard } from './authorization.guard';
import { AUTHORIZER, PERSONA_ACTIONS_DATA } from './tokens';

export interface AuthorizationModuleConfig {
  /** persona -> allowed actions, or '*' for unrestricted. See StaticRoleMapAuthorizer. */
  personaActions: Record<string, string[] | '*'>;
}

/**
 * A dynamic module — same reasoning as NotificationModule.forRoot(): requires
 * config because there's no sensible default persona/action map, unlike
 * domain-events, whose only knob (transport) has a sensible default.
 *
 * Does not apply AuthorizationGuard globally — it's provided and exported so
 * the consuming project decides how to wire it: globally via APP_GUARD, or
 * per-controller/per-route via @UseGuards(AuthorizationGuard). See this
 * module's README.
 */
@Module({})
export class AuthorizationModule {
  static forRoot(config: AuthorizationModuleConfig): DynamicModule {
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
