import { describe, expect, it } from 'vitest';
import { LocalDiskSigner } from './local-disk-signer';

const secret = 'x'.repeat(32);
const future = () => Math.floor(Date.now() / 1000) + 60;

describe('LocalDiskSigner', () => {
  it('round-trips a grant', () => {
    const signer = new LocalDiskSigner(secret);
    const grant = { fileRef: 'kyc/t1/a', expiresAt: future(), filename: 'ünïcode.pdf', contentType: 'application/pdf' };
    expect(signer.verify(signer.sign(grant))).toEqual(grant);
  });

  it('refuses an expired, forged or malformed token', () => {
    const signer = new LocalDiskSigner(secret);
    expect(signer.verify(signer.sign({ fileRef: 'a/b', expiresAt: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
    const token = signer.sign({ fileRef: 'a/b', expiresAt: future() });
    const [payload, mac] = token.split('.');
    const otherPayload = Buffer.from(JSON.stringify(['a/other', future(), null, null])).toString('base64url');
    expect(signer.verify(`${otherPayload}.${mac}`)).toBeNull();
    expect(new LocalDiskSigner('y'.repeat(32)).verify(token)).toBeNull();
    expect(signer.verify(payload)).toBeNull();
    expect(signer.verify(`${token}.x`)).toBeNull();
    expect(signer.verify('')).toBeNull();
  });
});
