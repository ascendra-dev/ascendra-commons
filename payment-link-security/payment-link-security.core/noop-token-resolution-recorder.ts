import type { TokenResolutionAttempt, TokenResolutionRecorder } from './token-resolution-recorder.port';

/** The default binding when no `recorderToken` is configured — every call resolves immediately and does nothing. */
export class NoopTokenResolutionRecorder implements TokenResolutionRecorder {
  async recordAttempt(_token: string, _attempt: TokenResolutionAttempt): Promise<void> {
    // intentionally inert
  }
}
