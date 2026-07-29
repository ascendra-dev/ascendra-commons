export class FileStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileStoreError';
  }
}
