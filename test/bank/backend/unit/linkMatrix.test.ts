/**
 * The link matrix agrees with the deployment manifests.
 *
 * The matrix declares every link's address in every environment so one variable can promote a
 * deployment. `environments/*.yaml` declares the same addresses for the cluster, and is the authority:
 * it is what Helm actually applies. Two declarations of one fact need something keeping them in step,
 * and this is it.
 *
 * THE DRIFT THIS CATCHES, which already happened once. GIAM's drone step publishes its release as
 * `sec-giam-api`, so the in-cluster service is `sec-giam-api-web-app`. Four call sites in each
 * manifest still named `sec-giam-web-app`, and every server-to-server call against the authority
 * broke: discovery, token exchange, introspection and JWKS, for the merchant, the platform and the
 * bank. Browser login kept working, because that path uses the public ingress host, so the platform
 * looked healthy from the outside while nothing behind it could get a token.
 *
 * Read from the YAML by hand rather than with a parser: these are flat `KEY: "value"` lines, and a
 * dependency for that is not worth the install.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LINK_MATRIX, PLATFORM_ENVIRONMENTS, type PlatformEnvironment } from '@leafypay/platform-links';

/** The environment variable each link is configured by, in the manifests. */
const VARIABLE_FOR = {
  bankcore: 'PSP_BANKCORE_BASE_URL',
  psp: 'PSP_BASE_URL',
  pspFrontend: 'PSP_URL_FRONTEND',
  authority: 'GIAM_BASE_URL',
} as const;

// `development` is local and has no manifest: its column IS the declaration.
const DEPLOYED = PLATFORM_ENVIRONMENTS.filter((name) => name !== 'development') as PlatformEnvironment[];

function manifestValues(environment: PlatformEnvironment): Record<string, string> {
  const text = readFileSync(join(process.cwd(), 'environments', `${environment}.yaml`), 'utf8');
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s{2}([A-Z][A-Z0-9_]*):\s*"?([^"#]*?)"?\s*$/.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

describe('the link matrix and the deployment manifests', () => {
  it('reads the manifests at all, so the checks below are not vacuous', () => {
    for (const environment of DEPLOYED) {
      expect(Object.keys(manifestValues(environment)).length, environment).toBeGreaterThan(5);
    }
  });

  for (const environment of DEPLOYED) {
    it(`agrees with environments/${environment}.yaml on every link`, () => {
      const values = manifestValues(environment);
      for (const [link, variable] of Object.entries(VARIABLE_FOR)) {
        const declared = values[variable];
        // A manifest that does not set the variable leaves the matrix as the only declaration, which
        // is allowed; disagreeing about it is not.
        if (!declared) continue;
        expect(LINK_MATRIX[link as keyof typeof VARIABLE_FOR][environment], `${link} in ${environment}`)
          .toBe(declared.replace(/\/$/, ''));
      }
    });
  }

  it('names the authority by its published service, not by its repository', () => {
    // The specific drift above, pinned by name so a revert is loud rather than subtle.
    for (const environment of DEPLOYED) {
      expect(LINK_MATRIX.authority[environment], environment).toContain('sec-giam-api');
    }
  });
});
