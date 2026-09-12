/** What `updateWithOptimisticLock()` returns — never throws for the ordinary "someone else updated it first" case. */
export type OptimisticLockResult = { ok: true } | { ok: false; reason: 'stale_version' };

/**
 * Thrown by call sites that choose to escalate a `{ ok: false }` result into a
 * control-flow exception — e.g. inside a multi-entity transaction (see the
 * module README's `withOptimisticLock` transaction example), where throwing
 * is what rolls the whole transaction back. `updateWithOptimisticLock()`
 * itself never throws this; it only returns the flat result.
 */
export class StaleVersionError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly entityId: string,
    public readonly expectedVersion: number,
  ) {
    super(
      `${entityType} ${entityId} was updated by someone else — expected version ${expectedVersion} is stale. ` +
        `Refetch and re-present to the actor for retry; never silently overwrite.`,
    );
    this.name = 'StaleVersionError';
  }
}
