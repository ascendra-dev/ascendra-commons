# File Storage Pattern

## Overview

File/document storage and the generic attachment mechanism that associates
an uploaded file with any entity — not scattered per-feature. Every part of
the system that needs to store or retrieve a file depends on `FileStore`,
backed initially by Supabase Storage.

This pattern depends on `authorization/` also being vendored —
`RegistryAttachmentAuthorizer` composes with the existing `Authorizer`
rather than reinventing coarse permission checking. Copy both folders
together.

Built and audited against `MODULE-STANDARD.md` (this repo's root). No
`applicationId` anywhere in this module — deliberately N/A, since a file lands
in one application's own Supabase Storage bucket, never a shared destination.
`tenantId` *is* threaded throughout — `FileStore.upload()`'s meta,
`FileRecord.tenantId`, and `FileStoreConfig.buildObjectKey()` all carry it,
since every stored file genuinely belongs to exactly one tenant.

## The pieces

### `FileStore` — defined once, never the implementation

```typescript
export interface FileStore {
  upload(file: Buffer, meta: { contentType: string; filename: string; category: string; tenantId: string | null }): Promise<{ fileRef: string }>;
  getUrl(fileRef: string, opts?: { expirySeconds?: number }): Promise<string>;
  delete(fileRef: string): Promise<void>;
}
```

No `Actor` anywhere on this interface — it's access-path-agnostic by
design. Whether a caller needs to be an authenticated actor at all is a
decision for whatever sits in front of `FileStore`, not `FileStore` itself.
That matters for more than tidiness: an anonymous caller following a signed
link with no session at all (a payment link, say) can still call
`getUrl(fileRef)` directly, entirely bypassing `RegistryAttachmentAuthorizer`
— that trust mechanism is real, project-specific, and out of scope for this
pattern to prescribe (see "What this pattern deliberately does not solve,"
below).

`fileRef` is an opaque string only the bound `FileStore` implementation
interprets. A future S3-compatible implementation can encode a completely
different scheme into it; `FileRecord.fileRef` never needs to know or care.

### `FileRecord` / `Attachment` — metadata in Postgres, not just the provider

```typescript
export interface FileRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly fileRef: string;
  readonly category: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedBy: string;
  readonly createdAt: Date;
}

export interface Attachment {
  readonly fileRecordId: string;
  readonly attachedToType: string;
  readonly attachedToId: string;
  readonly category: string;
}
```

Deliberately two rows, not one, even though most files have exactly one
attachment in practice: `FileRecord` is the fact that a blob exists;
`Attachment` is the fact that it's linked to a specific entity. Detaching an
association never deletes the underlying file — an attachment can be
removed while the `FileRecord` is retained for compliance.

### `AttachmentStore` — one atomic method, not two repositories with a shared transaction handle

```typescript
export interface AttachmentStore {
  attach(input: {
    fileRecord: Omit<FileRecord, 'id' | 'createdAt'>;
    attachment: Omit<Attachment, 'fileRecordId'>;
  }): Promise<{ fileRecord: FileRecord; attachment: Attachment }>;

  findByEntity(attachedToType: string, attachedToId: string): Promise<Array<Attachment & { fileRecord: FileRecord }>>;
}
```

A `FileRecord` with no `Attachment` would be a real bug — `attach()` bundles
that atomicity requirement into the contract itself, so the consumer's
implementation owns wrapping both writes in one transaction internally. This
library never needs to know what "transaction" means for whatever database
the consumer uses.

### Bucket and object-key strategy — configuration, not a hardcoded decision

```typescript
export interface FileStoreConfig {
  bucketForCategory(category: string): string;
  buildObjectKey(meta: { tenantId: string | null; category: string; filename: string }): string;
}
```

One shared bucket vs. a dedicated bucket per sensitive category; an opaque
random key vs. a structured, tenant-prefixed one browsable in the
provider's dashboard — neither is universally correct, so neither is
hardcoded into `SupabaseFileStore`. Both are supplied here. The simplest
possible config — `{ bucketForCategory: () => 'attachments', buildObjectKey: ({ filename }) => `${randomUUID()}-${filename}` }`
— reproduces the naive, single-bucket, opaque-key behavior; a project that
wants per-category buckets and browsable keys supplies a different one, same
`SupabaseFileStore`, no fork.

### `RegistryAttachmentAuthorizer` — composes `Authorizer` with per-entity-type access

```typescript
export interface EntityAccessChecker {
  canAccess(actor: Actor, entityId: string): Promise<boolean>;
}
```

`assertCanAttach`/`assertCanView` answer two different questions, and
conflating them would be wrong: "can this kind of actor ever do this" (a
flat, persona-level fact — `Authorizer.can(actor, action)`'s job) and "does
this actor have a relationship to *this specific* entity" (an instance-level
fact that depends on the entity's own type — checking invoice ownership is
nothing like checking issuer identity). The second needs a dispatch
mechanism across arbitrary, project-defined entity types — one
`EntityAccessChecker` per type the consumer registers, keyed by
`entityType`. An unregistered type fails closed (denied), never silently
open. `'attachment.upload'`/`'attachment.view'` are fixed action names —
part of this library's own contract, not a project-specific `Actions` entry
— so any persona that should attach or view files needs these two literal
strings in the consumer's own persona-action map.

## What this pattern deliberately does not solve

**Non-actor access.** An anonymous caller (a payment-link-following payer
with no session) needs a real, project-specific trust mechanism — signed
link tokens, their own validation, and their own mapping to a specific
entity's attachments. `FileStore.getUrl(fileRef)` needs no actor to do its
job, so whatever that mechanism resolves to reaches `fileRef` on its own
terms and calls the same method shown here — it just never goes through
`RegistryAttachmentAuthorizer` at all.

**A structural, database-enforced security backstop.** Every tenant-scoped
Postgres table in a well-built consumer has RLS as a backstop even if an
application-layer check is missed. Supabase Storage objects aren't Postgres
rows, and a real Supabase client capable of generating signed URLs and
managing objects server-side typically uses a service-role key, which
bypasses RLS by design. That means `RegistryAttachmentAuthorizer`'s check is
the *only* thing standing between an actor and a file that isn't theirs —
there is no structural backstop the way there is for an ordinary table.
Accepted as a necessary property of how object storage works, not a gap
this pattern can close.

**Expiry choice per context.** `getUrl(fileRef, { expirySeconds })`'s
`300`-second default (in the worked example, below) is right for a live,
in-app fetch — the frontend re-requests a fresh URL every page load. It's
wrong for a URL handed to something that might act on it later, most
concretely a link embedded directly in an emailed notification, which a
recipient could open long after a 5-minute URL expired. This pattern
supplies the parameter; choosing the right value per context is the
caller's job.

## Model 1 — Supabase-Backed Storage, No Content Scanning (current)

What's shipped: `FileStore`, `FileRecord`, `Attachment`, `AttachmentStore`,
`FileStoreConfig`, `SupabaseFileStore`, `EntityAccessChecker`,
`RegistryAttachmentAuthorizer`, and `FileStorageModule.forRoot()`. No virus/
content scanning, no versioning, no large-file/multipart handling beyond
what Supabase Storage provides natively.

## Model 2 — Content Scanning and Provider Portability (future target)

Virus/content scanning added to the upload path before a `FileRecord` is
considered valid; potentially an additional `FileStore` implementation (e.g.
S3-compatible) if Supabase Storage's limits are outgrown. Same `FileStore`
interface either way. Revisit before real volume makes the absence of
scanning a real risk — not before.

## Consuming this module

Copy `file-storage/` **and** `authorization/` into the consumer's
`src/ascendra-commons/` (see `module-packaging-pattern.md`):

```typescript
@Module({
  imports: [
    // The consumer's own already-configured AuthorizationModule, constructed once and
    // reused here — RegistryAttachmentAuthorizer depends on AUTHORIZER.
    AuthorizationModule.forRoot({ personaActions: { /* ... */ } }),
    FileStorageModule.forRoot({
      supabaseClientToken: SUPABASE_CLIENT,     // whatever token the app's own Supabase client is provided under
      attachmentStoreToken: ATTACHMENT_STORE_IMPL, // whatever token the app's own FileRecord/Attachment persistence is provided under
      fileStoreConfig: {
        bucketForCategory: () => 'attachments',
        buildObjectKey: ({ filename }) => `${randomUUID()}-${filename}`,
      },
      entityAccessCheckers: {
        invoice: invoiceAccessChecker,
        issuer: issuerAccessChecker,
      },
      imports: [DatabaseModule /* exports the Supabase client + attachment store tokens */],
    }),
  ],
})
export class AppModule {}
```

### Worked example: the upload endpoint

```typescript
@Post('attachments')
@UseInterceptors(FileInterceptor('file'))
async uploadAttachment(
  @UploadedFile() file: Express.Multer.File,
  @Body() dto: CreateAttachmentDto,
  @CurrentUser() actor: Actor,
) {
  await this.attachmentAuthorizer.assertCanAttach(actor, dto.attachedToType, dto.attachedToId);
  this.attachmentValidator.assertValid(dto.category, file); // project-specific per-category size/type rules

  const { fileRef } = await this.fileStore.upload(file.buffer, {
    contentType: file.mimetype,
    filename: file.originalname,
    category: dto.category,
    tenantId: actor.tenantId,
  });

  return this.attachmentStore.attach({
    fileRecord: { tenantId: actor.tenantId!, fileRef, category: dto.category, contentType: file.mimetype, sizeBytes: file.size, uploadedBy: actor.id },
    attachment: { attachedToType: dto.attachedToType, attachedToId: dto.attachedToId, category: dto.category },
  });
}
```

The storage upload happens before `attach()` and can't be rolled back if
that write fails afterward — an accepted, documented gap (an orphaned,
unreferenced blob costs storage bytes, not correctness or security), not
worth reconciliation tooling for at this stage.
