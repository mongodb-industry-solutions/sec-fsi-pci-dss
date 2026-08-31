// GIAM lives in its own repository (mongodb-industry-solutions/sec-giam) and is consumed over HTTP.
// A few suites still read its fixtures or its source, so they locate a local checkout of it here and
// skip honestly when there is none, rather than failing with a path nobody in this repo can create.
import { existsSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../..');

/** Absolute path to a file inside the GIAM checkout, wherever GIAM_REPO_PATH points. */
export function giamPath(relativePath: string): string {
  return resolve(REPO_ROOT, process.env.GIAM_REPO_PATH ?? '../sec-giam', relativePath);
}

/** True when a local GIAM checkout carrying the given path is available. */
export function hasGiam(relativePath: string): boolean {
  return existsSync(giamPath(relativePath));
}
