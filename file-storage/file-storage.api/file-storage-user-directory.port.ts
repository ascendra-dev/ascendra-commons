/**
 * Names for the people in the console — who uploaded a file, who downloaded
 * it, whose upload was refused. Optional: bind it under
 * `FileStorageApiModule.forRoot({ userDirectoryToken })` over the app's own
 * users table or identity provider; unbound, rows carry the ids alone. One
 * call per page, never one per row.
 */
export interface FileStorageUserDirectory {
  findByIds(ids: readonly string[]): Promise<Array<{ id: string; name: string | null }>>;
}
