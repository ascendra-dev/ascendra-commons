import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ClamdFileScanner, parseClamdReply } from './clamd-file-scanner';
import { ClamdFileScannerModule } from './clamd-file-scanner.module';
import { CLAMD_FILE_SCANNER } from './tokens';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

/** A fake clamd: reads zINSTREAM + chunks, answers FOUND when the stream holds the EICAR string. */
function fakeClamd(behaviour: 'answer' | 'silent' | 'error' = 'answer'): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (behaviour === 'silent') return;
        if (behaviour === 'error') return void socket.end('INSTREAM size limit exceeded. ERROR\0');
        const command = 'zINSTREAM\0'.length;
        let off = command;
        const body: Buffer[] = [];
        while (buf.length >= off + 4) {
          const size = buf.readUInt32BE(off);
          if (size === 0) {
            const text = Buffer.concat(body).toString('latin1');
            socket.end(text.includes('EICAR-STANDARD') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
            return;
          }
          if (buf.length < off + 4 + size) return;
          body.push(buf.subarray(off + 4, off + 4 + size));
          off += 4 + size;
        }
      });
    }).listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port));
  });
}

const meta = { contentType: 'application/pdf', filename: 'a.pdf' };

describe('ClamdFileScanner', () => {
  it('clean bytes → clean; the EICAR test string → infected (over several chunks)', async () => {
    const port = await fakeClamd();
    const scanner = new ClamdFileScanner({ host: '127.0.0.1', port, timeoutMs: 2_000 });
    expect(await scanner.scan(Buffer.from('%PDF-1.4 hello'), meta)).toBe('clean');
    const big = Buffer.concat([Buffer.alloc(200_000, 0x20), Buffer.from(EICAR)]);
    expect(await scanner.scan(big, meta)).toBe('infected');
  });

  it('an error line, a silent daemon, or no daemon → unscannable, never clean', async () => {
    let port = await fakeClamd('error');
    expect(await new ClamdFileScanner({ host: '127.0.0.1', port, timeoutMs: 1_000 }).scan(Buffer.from('x'), meta)).toBe('unscannable');
    await new Promise<void>((r) => server!.close(() => r()));
    port = await fakeClamd('silent');
    expect(await new ClamdFileScanner({ host: '127.0.0.1', port, timeoutMs: 200 }).scan(Buffer.from('x'), meta)).toBe('unscannable');
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    expect(await new ClamdFileScanner({ host: '127.0.0.1', port, timeoutMs: 500 }).scan(Buffer.from('x'), meta)).toBe('unscannable');
  });

  it('parseClamdReply', () => {
    expect(parseClamdReply('stream: OK')).toBe('clean');
    expect(parseClamdReply('1: Win.Test.EICAR_HDB-1 FOUND')).toBe('infected');
    expect(parseClamdReply('stream: Can\'t allocate memory ERROR')).toBe('unscannable');
    expect(parseClamdReply('')).toBe('unscannable');
  });
});

describe('ClamdFileScannerModule.forRoot', () => {
  it('needs a host, defaults the port, and binds the scanner', async () => {
    expect(() => ClamdFileScannerModule.forRoot({ host: '' })).toThrow(/requires host/);
    const ref = await Test.createTestingModule({ imports: [ClamdFileScannerModule.forRoot({ host: 'clamd' })] }).compile();
    expect(ref.get(CLAMD_FILE_SCANNER)).toBeInstanceOf(ClamdFileScanner);
  });
});
