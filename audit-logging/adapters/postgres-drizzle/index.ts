export { auditEventTable } from './audit-event.schema';
export type { SqlExecutor } from './sql-executor';
export { PostgresAuditEventRepository } from './postgres-audit-event.repository';
export { PostgresAuditPersistenceModule } from './postgres-audit-persistence.module';
export type { PostgresAuditPersistenceModuleConfig } from './postgres-audit-persistence.module';
export { PostgresAuditEventReader } from './postgres-audit-event-reader';
export { PostgresAuditObservabilityModule } from './postgres-audit-observability.module';
export type { PostgresAuditObservabilityModuleConfig } from './postgres-audit-observability.module';
export {
  AUDIT_SQL_EXECUTOR,
  AUDIT_APPLICATION_ID,
  POSTGRES_AUDIT_EVENT_REPOSITORY,
  POSTGRES_AUDIT_EVENT_READER,
} from './tokens';
