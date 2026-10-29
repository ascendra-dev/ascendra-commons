import { describe, expect, it } from 'vitest';
import { RuleBasedFileValidator, FileValidationError, extensionOf } from './file-validator.port';
import { assertFileMatchesCategory, type ResolvedFileCategory } from './file-category';

describe('extensionOf', () => {
  it('lowercases and drops the dot', () => expect(extensionOf('Scan.PDF')).toBe('pdf'));
  it('is null for no extension', () => expect(extensionOf('README')).toBeNull());
  it('is null for a dotfile', () => expect(extensionOf('.env')).toBeNull());
  it('is null for a trailing dot', () => expect(extensionOf('name.')).toBeNull());
});

describe('RuleBasedFileValidator (app-global)', () => {
  const v = new RuleBasedFileValidator({
    absoluteMaxSizeBytes: 10_000,
    deniedContentTypes: ['application/x-msdownload'],
    deniedExtensions: ['exe', '.sh'],
  });

  it('passes a normal file', () => {
    expect(() => v.validate({ sizeBytes: 500, contentType: 'image/png', filename: 'a.png' })).not.toThrow();
  });
  it('rejects over the hard ceiling', () => {
    expect(() => v.validate({ sizeBytes: 20_000, contentType: 'image/png', filename: 'a.png' })).toThrow(FileValidationError);
  });
  it('rejects a denied content type (case-insensitive)', () => {
    expect(() => v.validate({ sizeBytes: 1, contentType: 'Application/X-MSDownload', filename: 'a.bin' })).toThrow(FileValidationError);
  });
  it('rejects a denied extension regardless of the leading dot in config', () => {
    expect(() => v.validate({ sizeBytes: 1, contentType: 'text/plain', filename: 'run.SH' })).toThrow(FileValidationError);
  });
  it('no ceiling configured → any size passes', () => {
    expect(() => new RuleBasedFileValidator().validate({ sizeBytes: 9e9, contentType: 'x', filename: 'x' })).not.toThrow();
  });
});

describe('assertFileMatchesCategory', () => {
  const category: ResolvedFileCategory = {
    key: 'kyc.identity-document',
    label: 'ID',
    bucket: 'kyc',
    allowedContentTypes: ['image/jpeg', 'application/pdf'],
    allowedExtensions: ['jpg', 'jpeg', 'pdf'],
    maxSizeBytes: 8_000,
    minSizeBytes: 10,
    onUnscannable: 'reject',
    retention: 'indefinite',
    active: true,
  };

  it('passes a jpeg within bounds', () => {
    expect(() => assertFileMatchesCategory({ sizeBytes: 400, contentType: 'image/jpeg', filename: 'id.jpg' }, category)).not.toThrow();
  });
  it('rejects a content type not on the allow-list', () => {
    expect(() => assertFileMatchesCategory({ sizeBytes: 400, contentType: 'image/gif', filename: 'id.gif' }, category)).toThrow(FileValidationError);
  });
  it('rejects an extension not on the allow-list even when the content type matches', () => {
    expect(() => assertFileMatchesCategory({ sizeBytes: 400, contentType: 'application/pdf', filename: 'id.docx' }, category)).toThrow(FileValidationError);
  });
  it('rejects over max size', () => {
    expect(() => assertFileMatchesCategory({ sizeBytes: 9_000, contentType: 'image/jpeg', filename: 'id.jpg' }, category)).toThrow(FileValidationError);
  });
  it('rejects under min size (truncated upload)', () => {
    expect(() => assertFileMatchesCategory({ sizeBytes: 3, contentType: 'image/jpeg', filename: 'id.jpg' }, category)).toThrow(FileValidationError);
  });
  it('empty allowedContentTypes → any type accepted', () => {
    const open = { ...category, allowedContentTypes: [], allowedExtensions: undefined };
    expect(() => assertFileMatchesCategory({ sizeBytes: 400, contentType: 'anything/goes', filename: 'x.bin' }, open)).not.toThrow();
  });
});

describe('RuleBasedFileValidator — content signature', () => {
  const pdf = { sizeBytes: 10, contentType: 'application/pdf', filename: 'a.pdf' };
  it('refuses bytes that are not the declared type', () => {
    expect(() => new RuleBasedFileValidator().validate({ ...pdf, data: Buffer.from('<html>') })).toThrow(/doesn't start the way one does/);
    expect(() => new RuleBasedFileValidator().validate({ ...pdf, data: Buffer.from('MZ\x90') })).toThrow(/is a program/);
  });
  it('passes matching bytes, and skips the check with no bytes or when turned off', () => {
    expect(() => new RuleBasedFileValidator().validate({ ...pdf, data: Buffer.from('%PDF-1.4') })).not.toThrow();
    expect(() => new RuleBasedFileValidator().validate(pdf)).not.toThrow();
    expect(() => new RuleBasedFileValidator({ verifyContentSignature: false }).validate({ ...pdf, data: Buffer.from('<html>') })).not.toThrow();
  });
});
