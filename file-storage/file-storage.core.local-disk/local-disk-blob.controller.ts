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
import { downloadHeaders } from '../file-storage.core';
import { LocalDiskFileStore } from './local-disk-file-store';

/**
 * Builds the controller that serves `LocalDiskFileStore`'s signed URLs at
 * `GET /<path>/:token`. The token is the whole grant, so the route declares
 * `@NoActionRequired()`; `decorators` adds the consumer's own "no login
 * needed" marker (its authentication guard is the app's, not this library's).
 *
 * Every response: `nosniff`, a sandboxing CSP, no caching. A file is served
 * inline only for `INLINE_CONTENT_TYPES` (`.core`); everything else is an attachment.
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
      const { type, disposition } = downloadHeaders(object.contentType, object.filename);
      return new StreamableFile(createReadStream(object.path), { type, disposition, length: object.size });
    }
  }
  for (const decorate of decorators) decorate(LocalDiskBlobController);
  return LocalDiskBlobController;
}
