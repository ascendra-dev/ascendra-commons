/**
 * A hook for malware / content scanning, called on the upload bytes before
 * they reach storage.
 *
 *   - `clean`       — proceed.
 *   - `infected`    — always rejected (422), whatever the category says.
 *   - `unscannable` — the scanner couldn't reach a verdict (encrypted archive,
 *                     provider timeout). Outcome is the file's `FileCategory`
 *                     `onUnscannable` policy: `reject` or `allow`.
 *
 * Streaming a large file past the scanner rather than buffering it is a Model 2
 * concern (see `file-storage.core.s3`) — this contract takes a `Buffer`.
 */
export type ScanVerdict = 'clean' | 'infected' | 'unscannable';

export interface FileScanner {
  scan(data: Buffer, meta: { contentType: string; filename: string }): Promise<ScanVerdict>;
}

/**
 * The default when no scanner is wired: every file is reported `clean`.
 * This preserves today's behaviour (there is no scanning today) — a
 * deployment that needs scanning binds a real `FileScanner` via
 * `fileScannerToken`.
 */
export class NoopFileScanner implements FileScanner {
  async scan(): Promise<ScanVerdict> {
    return 'clean';
  }
}
