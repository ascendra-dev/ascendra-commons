/**
 * Per-tenant storage limits. Bound under `storageQuotaStoreToken`; unbound,
 * no tenant has a limit (`NoStorageQuotas`). A limit is soft under
 * concurrency: two uploads checked at the same moment can both fit and
 * together pass it by one file.
 */
export interface StorageQuotaStore {
  /** The tenant's limit, or `null` — no limit. */
  getQuota(tenantId: string): Promise<TenantQuota | null>;
  /** Bytes the tenant's files take now. */
  usage(tenantId: string): Promise<number>;
  setQuota(tenantId: string, maxBytes: number, updatedBy: string): Promise<TenantQuota>;
  /** Returns the limit that was removed, or `null` if there was none. */
  clearQuota(tenantId: string): Promise<TenantQuota | null>;
  /** Every tenant with a limit, with its usage — the console's Quotas screen. `tenantId` → that one only. */
  listQuotas(tenantId?: string): Promise<TenantQuotaUsage[]>;
}

export interface TenantQuota {
  tenantId: string;
  maxBytes: number;
  updatedAt: Date;
  updatedBy: string;
}

export interface TenantQuotaUsage extends TenantQuota {
  usedBytes: number;
  fileCount: number;
}

/** The default: no tenant has a limit. The admin writes say so rather than pretend. */
export class NoStorageQuotas implements StorageQuotaStore {
  async getQuota(): Promise<null> {
    return null;
  }
  async usage(): Promise<number> {
    return 0;
  }
  async setQuota(): Promise<never> {
    throw new Error('No StorageQuotaStore is bound — bind one via FileStorageModule.forRoot({ storageQuotaStoreToken }) to set limits');
  }
  async clearQuota(): Promise<null> {
    return null;
  }
  async listQuotas(): Promise<TenantQuotaUsage[]> {
    return [];
  }
}
