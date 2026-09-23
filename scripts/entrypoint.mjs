import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Is this module the script Node was told to run?
 *
 * `process.argv[1]` is whatever path the user invoked, which for an installed
 * `bin` is a symlink (`node_modules/.bin/next-or-not`) pointing at the real
 * file. `path.resolve` does not follow symlinks, so comparing resolved paths
 * silently fails there and the CLI exits 0 having done nothing. Compare real
 * paths instead, falling back to the plain comparison when either path cannot
 * be resolved.
 */
export function isMainModule(importMetaUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const modulePath = fileURLToPath(importMetaUrl);
  try {
    return fs.realpathSync(invoked) === fs.realpathSync(modulePath);
  } catch {
    return path.resolve(invoked) === modulePath;
  }
}
