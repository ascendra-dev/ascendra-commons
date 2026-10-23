import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ActionNotFoundError,
  CannotDelegateError,
  InvalidAuthzCursorError,
  InvalidDelegationExpiryError,
  RoleNotFoundError,
} from '../../authorization.core.permission-table';

/** The family's domain errors as the HTTP answer they deserve — a caller's mistake, never a 500. */
export function toHttpError(err: unknown): unknown {
  if (err instanceof RoleNotFoundError) return new NotFoundException(err.message);
  if (err instanceof ActionNotFoundError) return new NotFoundException(err.message);
  if (err instanceof CannotDelegateError) return new BadRequestException(err.message);
  if (err instanceof InvalidDelegationExpiryError) return new BadRequestException(err.message);
  if (err instanceof InvalidAuthzCursorError) {
    return new BadRequestException('"cursor" is not one this endpoint returned — start again without it');
  }
  return err;
}

/** Runs `fn`, re-throwing a domain error as its HTTP answer. */
export async function mapErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toHttpError(err);
  }
}
