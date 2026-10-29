import { BadRequestException } from '@nestjs/common';

import { decodeKeysetCursor, isUuid } from '../../file-storage.core';

/**
 * Request validation for `file-storage.api` — `ascendra-commons` carries no validation library. A caller's mistake is
 * a 400 naming what to fix, never a 500: an Invalid Date only fails when the driver serializes it, `?limit=abc`
 * arrives as NaN, a NUL byte fails Postgres' `text`, a non-uuid fails `::uuid`. Duplicated from `notification.api`
 * so the module stays copyable.
 */

/** Ids and names are short — a tenant, a category key, a user id. */
const MAX_ID_LENGTH = 256;

export function idParam(name: string, value: unknown): string;
export function idParam(name: string, value: unknown, optional: true): string | undefined;
export function idParam(name: string, value: unknown, optional = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw new BadRequestException(`"${name}" is required`);
  }
  if (typeof value !== 'string') throw new BadRequestException(`"${name}" must be a string`);
  if (value.includes('\u0000')) throw new BadRequestException(`"${name}" must not contain a NUL byte`);
  if (value.length > MAX_ID_LENGTH) throw new BadRequestException(`"${name}" must be at most ${MAX_ID_LENGTH} characters`);
  return value;
}

/** Free text (a template body, a subject) — bounded, no NUL. */
export function textParam(name: string, value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`"${name}" must be a string`);
  if (value.includes('\u0000')) throw new BadRequestException(`"${name}" must not contain a NUL byte`);
  if (value.length > max) throw new BadRequestException(`"${name}" must be at most ${max} characters`);
  return value;
}

export function dateParam(name: string, value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new BadRequestException(`"${name}" must be an ISO 8601 date-time`);
  return date;
}

export function enumParam<T extends string>(name: string, value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(`"${name}" must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function booleanParam(name: string, value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new BadRequestException(`"${name}" must be true or false`);
  return value;
}

/** A query flag — the strings `true` / `false`; anything else (`1`, `TRUE`) is a 400, never a silently ignored filter. */
export function flagParam(name: string, value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(`"${name}" must be true or false`);
}

/** A plain JSON object — `{ ... }`, not an array or a scalar. */
export function objectParam(name: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(`"${name}" must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** api-contract.md Rule 4's cursor-based list shape. An absent `nextCursor` serializes as `meta: {}`. */
export function cursorList<T>(data: T[], nextCursor?: string) {
  return { data, meta: { nextCursor } };
}

/** A file, attachment or access-log id — a uuid. Anything else can't name one; a 400 rather than a 500 from `::uuid`. */
export function uuidParam(name: string, value: unknown): string {
  const id = idParam(name, value);
  if (!isUuid(id)) throw new BadRequestException(`"${name}" must be a uuid`);
  return id;
}

/** A whole number in [min, max] — `?limit=500` is a 400 naming the ceiling, never silently clamped. */
export function intParam(name: string, value: string | undefined, min: number, max: number): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new BadRequestException(`"${name}" must be a whole number from ${min} to ${max}`);
  }
  return n;
}

/** A cursor this list issued — checked here so a forged or stale one is a 400, never page one again. */
export function cursorParam(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!decodeKeysetCursor(value)) throw new BadRequestException('"cursor" is not one this list issued');
  return value;
}

/** A list of short strings in a body — `null` passes through (it means "inherit"). */
export function stringListParam(name: string, value: unknown, maxItems = 100): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) throw new BadRequestException(`"${name}" must be a list of strings, or null`);
  if (value.length > maxItems) throw new BadRequestException(`"${name}" must have at most ${maxItems} entries`);
  return value.map((v, i) => idParam(`${name}[${i}]`, v));
}

/** A whole number in a body, or `null` (inherit). */
export function bodyIntParam(name: string, value: unknown, min: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new BadRequestException(`"${name}" must be a whole number, at least ${min}, or null`);
  }
  return value;
}

/** A body's keys must all be known — a typo (`maxSize`) is a 400, never a silently ignored setting. */
export function knownKeys(name: string, body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new BadRequestException(`${name} has unknown field${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')} — allowed: ${allowed.join(', ')}`);
  }
}
