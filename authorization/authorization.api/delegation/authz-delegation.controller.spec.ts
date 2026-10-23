import { describe, expect, it } from 'vitest';
import { ACTION_METADATA_KEY, NO_ACTION_REQUIRED_KEY } from '../../authorization.core';
import { AuthzDelegationController } from './authz-delegation.controller';

const gate = (method: keyof AuthzDelegationController) => {
  const handler = AuthzDelegationController.prototype[method];
  return Reflect.getMetadata(NO_ACTION_REQUIRED_KEY, handler) ? 'signed in' : Reflect.getMetadata(ACTION_METADATA_KEY, handler);
};

describe('AuthzDelegationController — gates', () => {
  it('lets anyone signed in read their own delegations and give back or take back; lending needs the action', () => {
    expect(gate('mine')).toBe('signed in');
    expect(gate('revoke')).toBe('signed in'); // the service decides: granter, grantee, a role admin or a platform admin
    expect(gate('create')).toBe('authz.manage_delegations');
    expect(gate('list')).toBe('authz.view');
  });
});
