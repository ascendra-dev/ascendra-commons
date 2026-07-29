/**
 * A generic, polymorphic association on top of FileRecord, not a
 * feature-specific concept — the same mechanism covers a KYC upload, an
 * invoice PDF, dispute evidence, or any future case, unmodified.
 *
 * Deliberately a separate row from FileRecord, even though most files have
 * exactly one attachment in practice: FileRecord is the fact that a blob
 * exists in storage; Attachment is the fact that it's linked to a specific
 * business entity. Detaching an association does not have to mean deleting
 * the underlying file — an attachment can be removed while the FileRecord
 * itself is retained for compliance.
 */
export interface Attachment {
  readonly fileRecordId: string;
  readonly attachedToType: string; // 'issuer' | 'invoice' | 'workflow_step' | ... — consumer-defined
  readonly attachedToId: string;
  readonly category: string; // 'kyc_document' | 'dispute_evidence' | ... — consumer-defined
}
