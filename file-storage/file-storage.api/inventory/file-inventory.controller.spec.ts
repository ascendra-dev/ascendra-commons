import { describe, expect, it } from 'vitest';
import { FileInventoryController } from './file-inventory.controller';

describe('FileInventoryController', () => {
  it('declares every literal GET route before GET :id — Express matches in declaration order', () => {
    const methods = Object.getOwnPropertyNames(FileInventoryController.prototype);
    const getOne = methods.indexOf('getOne');
    for (const literal of ['list', 'storageUsage', 'orphans', 'stats', 'rejections', 'duplicates']) {
      expect(methods.indexOf(literal), literal).toBeLessThan(getOne);
    }
  });
});
