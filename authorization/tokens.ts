/**
 * Injection tokens. Symbols, not string literals, same reasoning as every
 * other module in this library — a typo in a binding is a compile error, not
 * a silently unbound provider.
 */

/** The raw persona -> allowed actions map StaticRoleMapAuthorizer reads. Consumer-supplied via AuthorizationModule.forRoot(). */
export const PERSONA_ACTIONS_DATA = Symbol('PERSONA_ACTIONS_DATA');

/** What AuthorizationGuard and feature code actually depend on — bound to whichever Authorizer implementation the app uses. */
export const AUTHORIZER = Symbol('AUTHORIZER');
