import type { FileStorageUserDirectory } from '../file-storage-user-directory.port';

/** The cap on ids looked up for one page — a page is at most 200 rows. */
const MAX_IDS = 500;

/**
 * Names for the user ids on a page, in one `findByIds` call. No directory, a
 * failing one, or an id it doesn't know → no entry: the console shows the id.
 * A name lookup never fails the read.
 */
export async function userNames(
  directory: FileStorageUserDirectory | null,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id && !id.startsWith('system:')))].slice(0, MAX_IDS);
  const names = new Map<string, string>();
  if (!directory || unique.length === 0) return names;
  try {
    for (const user of await directory.findByIds(unique)) if (user.name) names.set(user.id, user.name);
  } catch {
    /* names are a nicety — the ids stand */
  }
  return names;
}
