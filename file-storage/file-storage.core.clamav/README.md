# file-storage.core.clamav

A real `FileScanner` — ClamAV's daemon (`clamd`), over its `INSTREAM`
protocol on TCP. No client library: the protocol is a command, the bytes as
length-prefixed chunks, and one reply line.

- `stream: OK` → `clean`; `stream: <signature> FOUND` → `infected` (always a 422).
- Anything else → `unscannable`: the daemon down or slower than `timeoutMs`,
  a stream over clamd's `StreamMaxLength`, an error line. Never `clean` — the
  file's category decides (`onUnscannable: 'reject' | 'allow'`), not a network blip.
- Every `unscannable` is logged (type and size, never the filename).

## Wiring

```typescript
ClamdFileScannerModule.forRoot({ host: 'clamd', port: 3310, timeoutMs: 30_000 })
// → binds CLAMD_FILE_SCANNER; point FileStorageModule.forRoot({ fileScannerToken: CLAMD_FILE_SCANNER }) at it
```

Run clamd beside the API (the `clamav/clamav` image; it needs a minute and
~1 GB of memory to load its signatures). Raise clamd's `StreamMaxLength` to at
least the largest category's `maxSizeBytes`, or large files come back
`unscannable`. Test with the EICAR string — every scanner flags it, and it is harmless.
