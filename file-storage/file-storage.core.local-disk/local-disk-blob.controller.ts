import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import {
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  PayloadTooLargeException,
  Put,
  Req,
  StreamableFile,
  UnsupportedMediaTypeException,
  type Type,
} from '@nestjs/common';
import { NoActionRequired } from '../../authorization/authorization.core';
import { downloadHeaders } from '../file-storage.core';
import { LocalDiskFileStore } from './local-disk-file-store';

/**
 * Builds the controller that serves `LocalDiskFileStore`'s signed URLs at
 * `GET /<path>/:token` and takes direct uploads at `PUT /<path>/:token`. The token is the whole grant, so the route declares
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

    /**
     * A direct upload's body (`beginUpload`'s URL). 403 for a bad or expired
     * token, 413 over the declared size, 409 if the object already exists,
     * 415 when a body parser already consumed the body (send
     * `application/octet-stream`, as `createUploadUrl`'s headers say).
     */
    @Put(':token')
    @HttpCode(204)
    @NoActionRequired()
    async upload(@Param('token') token: string, @Req() req: Readable & { readableEnded?: boolean; body?: unknown }): Promise<void> {
      if (req.readableEnded || (req.body !== undefined && !(typeof req.body === 'object' && req.body !== null && Object.keys(req.body).length === 0))) {
        throw new UnsupportedMediaTypeException('send the bytes as application/octet-stream');
      }
      const outcome = await this.store.receive(token, req);
      if (outcome === 'invalid') throw new ForbiddenException('this upload link is invalid or has expired');
      if (outcome === 'too-large') throw new PayloadTooLargeException('the upload is larger than declared');
      if (outcome === 'exists') throw new ConflictException('something was already uploaded to this link');
    }
  }
  for (const decorate of decorators) decorate(LocalDiskBlobController);
  return LocalDiskBlobController;
}
