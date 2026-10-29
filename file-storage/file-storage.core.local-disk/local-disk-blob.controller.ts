import { createReadStream } from 'node:fs';
import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  StreamableFile,
  type Type,
} from '@nestjs/common';
import { NoActionRequired } from '../../authorization/authorization.core';
import { LocalDiskFileStore } from './local-disk-file-store';

/**
 * Types a browser may show in its own tab. Anything else downloads — an HTML
 * or SVG upload never runs as a page on the app's origin.
 */
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);

/** RFC 6266 `Content-Disposition` with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string | undefined): string {
  if (!filename) return kind;
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Builds the controller that serves `LocalDiskFileStore`'s signed URLs at
 * `GET /<path>/:token`. The token is the whole grant, so the route declares
 * `@NoActionRequired()`; `decorators` adds the consumer's own "no login
 * needed" marker (its authentication guard is the app's, not this library's).
 *
 * Every response: `nosniff`, a sandboxing CSP, no caching. A file is served
 * inline only for the few types in `INLINE_TYPES`; everything else is an attachment.
 */
export function createLocalDiskBlobController(path: string, decorators: ReadonlyArray<ClassDecorator> = []): Type<unknown> {
  @Controller(path)
  class LocalDiskBlobController {
    constructor(@Inject(LocalDiskFileStore) private readonly store: LocalDiskFileStore) {}

    @Get(':token')
    @NoActionRequired()
    @Header('X-Content-Type-Options', 'nosniff')
    @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    @Header('Cache-Control', 'private, no-store')
    @Header('Referrer-Policy', 'no-referrer')
    async serve(@Param('token') token: string): Promise<StreamableFile> {
      const object = await this.store.open(token);
      if (!object) throw new ForbiddenException('this link is invalid or has expired');
      const type = object.contentType?.toLowerCase() ?? 'application/octet-stream';
      const inline = INLINE_TYPES.has(type);
      return new StreamableFile(createReadStream(object.path), {
        type: inline ? type : 'application/octet-stream',
        disposition: contentDisposition(inline ? 'inline' : 'attachment', object.filename),
        length: object.size,
      });
    }
  }
  for (const decorate of decorators) decorate(LocalDiskBlobController);
  return LocalDiskBlobController;
}
