import { describe, expect, it } from 'vitest';
import {
  PermissionTableAuthorizer,
  PermissionTableAuthorizerNotImplementedError,
} from './permission-table-authorizer';

const ACTOR = { id: 'u1', persona: 'issuer', tenantId: 't1' };

describe('PermissionTableAuthorizer — the Model 2 seam, unimplemented', () => {
  it('rejects can() with PermissionTableAuthorizerNotImplementedError', async () => {
    const authorizer = new PermissionTableAuthorizer();

    await expect(authorizer.can(ACTOR, 'invoice.void')).rejects.toBeInstanceOf(
      PermissionTableAuthorizerNotImplementedError,
    );
  });
});
