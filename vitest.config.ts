import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Restore every vi.spyOn after each test. Since vitest 4, spying on an already-spied method returns the same spy,
    // so without this a spy's calls leak into the next test that spies the same method.
    restoreMocks: true,
  },
});
