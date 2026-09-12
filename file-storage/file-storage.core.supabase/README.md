# file-storage.core.supabase

The **Model 1** `FileStore` backend — Supabase Storage.

`SupabaseFileStore` implements `file-storage.core`'s `FileStore` over
`@supabase/supabase-js`:

- `upload` puts the bytes in `meta.bucket` (resolved by `AttachmentService` from
  the file's `FileCategory`) at `FileStoreConfig.buildObjectKey(meta)` — the
  client filename is never used verbatim as the storage path. `fileRef` is
  `"{bucket}/{objectKey}"`, opaque to callers.
- `getUrl` → `createSignedUrl(objectKey, expirySeconds ?? 300)`.
- `delete` → `.remove([objectKey])`.
- Provider errors become `FileStoreError`, never the raw SDK error.

## Wiring

```typescript
SupabaseFileStoreModule.forRoot({
  supabaseClientToken: SUPABASE_CLIENT,   // the app's own client — this package never creates one
  fileStoreConfig: { buildObjectKey: ({ tenantId, category, filename }) => `${tenantId ?? 'shared'}/${category}/${randomUUID()}` },
  imports: [DatabaseModule],
})
// → binds SUPABASE_FILE_STORE; point FileStorageModule.forRoot({ fileStoreToken: SUPABASE_FILE_STORE }) at it
```

The bucket per category is a field on the `FileCategory` (see the catalog in
`file-storage.core.postgres-drizzle`), not on `FileStoreConfig` — this package
only decides the object key.
