import { SetMetadata } from '@nestjs/common';

export const ACTION_METADATA_KEY = 'authorization:action';

/**
 * One action per state-changing endpoint, declared once via decorator and
 * checked globally by AuthorizationGuard before the handler runs — not a
 * manual `if (!can(...))` remembered (or forgotten) per handler.
 */
export const RequiresAction = (action: string) => SetMetadata(ACTION_METADATA_KEY, action);
