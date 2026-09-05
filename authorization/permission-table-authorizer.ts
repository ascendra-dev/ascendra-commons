import { Injectable } from '@nestjs/common';
import { Actor } from './authorization.types';
import { Authorizer } from './authorizer';

/** Thrown by every PermissionTableAuthorizer method — it is a stub, not a real authorizer. */
export class PermissionTableAuthorizerNotImplementedError extends Error {
  constructor() {
    super(
      'AuthorizationModule was imported with model: "permission-table" but no authorizerToken. ' +
        'Pass authorizerToken (+ imports) pointing at a real Authorizer — the postgres-drizzle ' +
        "adapter's POSTGRES_PERMISSION_TABLE_AUTHORIZER, or your own — or use model: " +
        '"static-persona-map" (the default).',
    );
    this.name = 'PermissionTableAuthorizerNotImplementedError';
  }
}

/**
 * The "Model 2 selected but not wired" placeholder. `AuthorizationModule.forRoot({
 * model: 'permission-table' })` binds this only when no `authorizerToken` is
 * given, so the mistake fails loudly on the first `can()` instead of silently.
 *
 * A real database-backed authorizer ships in `adapters/postgres-drizzle/`
 * (`PostgresPermissionTableAuthorizer`) — a project on that stack passes its
 * token to `forRoot()`. A project on another stack provides its own `Authorizer`
 * and passes that token. Either way this stub is never reached.
 *
 * Never hand-edit this file into a real implementation — it lives under the
 * vendored `src/ascendra-commons/authorization/` folder and is overwritten on
 * any re-copy (same boundary as `BrokerDomainEventEmitter`).
 */
@Injectable()
export class PermissionTableAuthorizer implements Authorizer {
  async can(_actor: Actor, _action: string): Promise<boolean> {
    throw new PermissionTableAuthorizerNotImplementedError();
  }
}
