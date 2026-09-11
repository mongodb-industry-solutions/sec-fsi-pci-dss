// GIAM lives in its own repository (mongodb-industry-solutions/sec-giam) and is consumed over HTTP.
// A few suites still read its fixtures or its source, so they locate a local checkout of it here and
// skip honestly when there is none, rather than failing with a path nobody in this repo can create.
import { existsSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../..');

/**
 * Where the checkout is, in preference order.
 *
 * `GIAM_REPO_PATH` wins when it is set, which is how CI and docker-compose point at it. Otherwise
 * the sibling layout is tried first, because that is the documented one, and then `tmp/sec-giam`,
 * which is where a working checkout actually sits during development. Probing rather than assuming
 * one of them is why a suite that reads a fixture now finds it either way.
 */
const CANDIDATES = ['../sec-giam', 'tmp/sec-giam'];

/** The checkout root, or the documented default when none is present. */
function giamRoot(): string {
  if (process.env.GIAM_REPO_PATH) return resolve(REPO_ROOT, process.env.GIAM_REPO_PATH);
  const found = CANDIDATES.find((candidate) => existsSync(resolve(REPO_ROOT, candidate)));
  return resolve(REPO_ROOT, found ?? CANDIDATES[0]);
}

/** Absolute path to a file inside the GIAM checkout, wherever GIAM_REPO_PATH points. */
export function giamPath(relativePath: string): string {
  return resolve(giamRoot(), relativePath);
}

/** True when a local GIAM checkout carrying the given path is available. */
export function hasGiam(relativePath: string): boolean {
  return existsSync(giamPath(relativePath));
}
