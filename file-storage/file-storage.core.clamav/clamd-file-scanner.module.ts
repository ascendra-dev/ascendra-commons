import { DynamicModule, Module } from '@nestjs/common';
import { ClamdFileScanner, type ClamdOptions } from './clamd-file-scanner';
import { CLAMD_FILE_SCANNER, CLAMD_OPTIONS } from './tokens';

export interface ClamdFileScannerModuleConfig {
  /** clamd's host. Required. */
  host: string;
  /** Default 3310. */
  port?: number;
  /** Default 30000. */
  timeoutMs?: number;
}

/**
 * Binds `ClamdFileScanner` → `CLAMD_FILE_SCANNER`; point
 * `FileStorageModule.forRoot({ fileScannerToken })` at it and import this
 * module in the same `imports` array.
 */
@Module({})
export class ClamdFileScannerModule {
  static forRoot(config: ClamdFileScannerModuleConfig): DynamicModule {
    if (!config?.host) throw new Error('ClamdFileScannerModule.forRoot() requires host — where clamd listens');
    const options: ClamdOptions = { host: config.host, port: config.port ?? 3310, timeoutMs: config.timeoutMs ?? 30_000 };
    return {
      module: ClamdFileScannerModule,
      providers: [
        { provide: CLAMD_OPTIONS, useValue: options },
        ClamdFileScanner,
        { provide: CLAMD_FILE_SCANNER, useExisting: ClamdFileScanner },
      ],
      exports: [CLAMD_FILE_SCANNER],
    };
  }
}
