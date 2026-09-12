/**
 * Errors the admin port raises. Defined in the family package (not a stack
 * adapter) so `authorization.api` — and any other caller — can `catch` them and
 * map to an HTTP status without depending on a specific adapter.
 */

/** Thrown by `assignRole` when the `roleId` has no role-catalog row. */
export class RoleNotFoundError extends Error {
  constructor(public readonly roleId: string) {
    super(`No role '${roleId}' in the role catalog.`);
    this.name = 'RoleNotFoundError';
  }
}

/** Thrown by `setActionDescription` when the action has no catalog row (run `syncActions()` first). */
export class ActionNotFoundError extends Error {
  constructor(public readonly action: string) {
    super(`No action '${action}' in the action catalog.`);
    this.name = 'ActionNotFoundError';
  }
}
