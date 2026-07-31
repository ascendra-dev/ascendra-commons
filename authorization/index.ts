export type { Actor } from './authorization.types';

export type { Authorizer } from './authorizer';
export { StaticRoleMapAuthorizer } from './authorizer';

export { RequiresAction, ACTION_METADATA_KEY } from './requires-action.decorator';
export { AuthorizationGuard } from './authorization.guard';

export type { SessionSnapshot } from './session-snapshot';
export { computeSessionSnapshot } from './session-snapshot';

export type { ActionAvailability, StateValidity } from './action-availability';
export { computeActionAvailability } from './action-availability';

export { AuthorizationModule } from './authorization.module';
export type { AuthorizationModuleConfig } from './authorization.module';

export { PERSONA_ACTIONS_DATA, AUTHORIZER } from './tokens';
