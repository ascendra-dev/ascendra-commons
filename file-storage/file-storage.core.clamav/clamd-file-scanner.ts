import { connect } from 'node:net';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FileScanner, ScanVerdict } from '../file-storage.core';
import { CLAMD_OPTIONS } from './tokens';

export interface ClamdOptions {
  host: string;
  /** Default 3310. */
  port: number;
  /** A scan that takes longer is `unscannable` — the category's `onUnscannable` decides. Default 30 s. */
  timeoutMs: number;
}

const CHUNK = 64 * 1024;

/**
 * A `FileScanner` over a ClamAV daemon (`clamd`), speaking its `INSTREAM`
 * protocol over TCP — no client library. `clean` / `infected` are clamd's own
 * answers; anything else — the daemon down, a timeout, a stream over clamd's
 * `StreamMaxLength`, an error line — is `unscannable`, never `clean`: the
 * file's category decides (`onUnscannable`), not a network blip.
 */
@Injectable()
export class ClamdFileScanner implements FileScanner {
  private readonly logger = new Logger(ClamdFileScanner.name);

  constructor(@Inject(CLAMD_OPTIONS) private readonly options: ClamdOptions) {}

  async scan(data: Buffer, meta: { contentType: string; filename: string }): Promise<ScanVerdict> {
    let reply: string;
    try {
      reply = await this.instream(data);
    } catch (e) {
      this.logger.warn(`clamd unreachable or slow for ${meta.contentType} (${data.length} bytes): ${(e as Error).message}`);
      return 'unscannable';
    }
    const verdict = parseClamdReply(reply);
    if (verdict === 'unscannable') this.logger.warn(`clamd could not scan ${meta.contentType} (${data.length} bytes): ${reply}`);
    return verdict;
  }

  /** `zINSTREAM`, the bytes as length-prefixed chunks, a zero-length chunk, then clamd's one NUL-terminated line. */
  private instream(data: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.options.host, port: this.options.port });
      const chunks: Buffer[] = [];
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        fn();
      };
      socket.setTimeout(this.options.timeoutMs, () => done(() => reject(new Error(`no answer in ${this.options.timeoutMs} ms`))));
      socket.on('error', (e) => done(() => reject(e)));
      socket.on('data', (d) => {
        chunks.push(d);
        const all = Buffer.concat(chunks);
        const nul = all.indexOf(0);
        if (nul >= 0) done(() => resolve(all.subarray(0, nul).toString('utf8')));
      });
      socket.on('end', () => done(() => resolve(Buffer.concat(chunks).toString('utf8'))));
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let i = 0; i < data.length; i += CHUNK) {
          const part = data.subarray(i, i + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(part.length);
          socket.write(size);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4));
      });
    });
  }
}

/** clamd's reply → a verdict. `stream: OK` → clean; `stream: <name> FOUND` → infected; anything else → unscannable. */
export function parseClamdReply(reply: string): ScanVerdict {
  const line = reply.trim();
  if (/^(stream|\d+): OK$/.test(line)) return 'clean';
  if (/^(stream|\d+): .+ FOUND$/.test(line)) return 'infected';
  return 'unscannable';
}
