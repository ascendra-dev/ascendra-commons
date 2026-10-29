-- file-storage · the attachment table takes the module's prefix, as every other commons table does
-- (MODULE-STANDARD.md dimension 7: commons_<module>_<table>). Never edited once released — see 0001's header.

ALTER TABLE IF EXISTS "commons_attachment" RENAME TO "commons_file_attachment";
ALTER INDEX IF EXISTS "commons_attachment_entity_idx" RENAME TO "commons_file_attachment_entity_idx";
ALTER INDEX IF EXISTS "commons_attachment_file_record_idx" RENAME TO "commons_file_attachment_file_record_idx";
ALTER INDEX IF EXISTS "commons_attachment_pkey" RENAME TO "commons_file_attachment_pkey";
ALTER TABLE IF EXISTS "commons_file_attachment"
  RENAME CONSTRAINT "commons_attachment_file_record_id_fkey" TO "commons_file_attachment_file_record_id_fkey";
