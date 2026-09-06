import { CallHandler, ConflictException, ExecutionContext, HttpException, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, from, map, of, switchMap, throwError } from 'rxjs';
import type { IdempotencyStore } from './idempotency-store.port';
import type { IdempotencyScopeResolver } from './idempotency-scope-resolver.port';
import { IDEMPOTENCY_SCOPE_RESOLVER, IDEMPOTENCY_STORE } from './tokens';

interface MinimalRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
}

/**
 * A 409 on 'in_progress' is deliberate: this interceptor never blocks a
 * request waiting for another one to finish (that ties up a request thread
 * for an unbounded time) — it fails fast. The frontend is expected to have
 * the submit control disabled while the first attempt is in flight anyway;
 * this is a safety net for the case that discipline doesn't catch, not the
 * primary defense.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
    @Inject(IDEMPOTENCY_SCOPE_RESOLVER) private readonly scopeResolver: IdempotencyScopeResolver,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<MinimalRequest>();
    const key = request.headers['idempotency-key'];
    if (!key || typeof key !== 'string') return next.handle(); // endpoint doesn't require it, or client omitted it

    const scope = await this.scopeResolver.resolveScope(request);
    const claim = await this.store.claim(key, scope);

    if (claim.status === 'completed') {
      // Replay verbatim, including the original status — a cached error must come back as
      // that same error, not silently reported as a success with the error's body.
      const { statusCode, body } = claim.response;
      return statusCode >= 400
        ? throwError(() => new HttpException(body as string | Record<string, unknown>, statusCode))
        : of(body);
    }
    if (claim.status === 'in_progress') throw new ConflictException();

    const { claimId } = claim;

    // The real status this handler will return — @HttpCode() if set, otherwise NestJS's own
    // default (201 for POST, 200 otherwise). Never hardcoded: every endpoint this pattern is
    // meant for is a POST that plausibly returns 201, and a cached response claiming 200 would
    // simply be wrong.
    const explicitCode = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler());
    const statusCode = explicitCode ?? (request.method === 'POST' ? 201 : 200);

    return next.handle().pipe(
      // switchMap, not tap — tap's callback isn't awaited, which would let the client receive
      // a response before this write actually lands. A retry arriving in that window would
      // still see the row as 'pending' and get a wrong 409 instead of the correct cached
      // response. Awaiting here, before the response is emitted, closes that race.
      switchMap((body) => from(this.store.complete(key, scope, claimId, { statusCode, body })).pipe(map(() => body))),
      catchError((err: unknown) => {
        // Only a definitive HttpException (the handler explicitly rejected this request —
        // validation, a business-rule violation) is cached and replayed verbatim. An
        // unexpected/transient error (a raw throw, a timeout) is not — a retry re-attempting
        // the operation is more likely correct than replaying a possibly-spurious failure
        // forever until the claim goes stale.
        const cache =
          err instanceof HttpException
            ? this.store.complete(key, scope, claimId, { statusCode: err.getStatus(), body: err.getResponse() })
            : Promise.resolve();
        return from(cache).pipe(switchMap(() => throwError(() => err)));
      }),
    );
  }
}
