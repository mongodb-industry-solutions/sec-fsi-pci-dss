// v37: what each image must actually contain, which nothing else checks.
//
// This class of defect only appears in a deployment: on a developer machine the whole repository is on
// disk, so a Dockerfile that forgets a workspace works locally and fails in staging with an npm path
// error or a missing type. Three concrete holes this pins:
//
//   · a service importing a shared `file:` package whose Dockerfile never installs it. The package is
//     consumed through its compiled `dist`, so the image build fails on a missing type;
//   · such a service built with its own directory as the build context, where `packages/` is not even
//     in the context and every COPY of it silently produces nothing;
//   · the backend image not shipping the bank workspace, even though its setup, seed, validate and drop
//     entry points all run `npm run <script> --prefix bankcore`, and so does the admin panel.
//
// The checks are derived, not listed: a workspace is found by having a Dockerfile, and its shared
// packages by its own `file:../packages/` dependencies. A new service or a new package is covered the
// day it is added rather than the day someone remembers this file.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');

function read(...parts: string[]): string {
  return readFileSync(resolve(ROOT, ...parts), 'utf8');
}

function serviceWorkspaces(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'packages')
    .map((entry) => entry.name)
    .filter((name) => existsSync(resolve(ROOT, name, 'Dockerfile')) && existsSync(resolve(ROOT, name, 'package.json')));
}

function sharedDependenciesOf(workspace: string): string[] {
  const deps = (JSON.parse(read(workspace, 'package.json')) as { dependencies?: Record<string, string> }).dependencies ?? {};
  return Object.values(deps)
    .filter((spec) => spec.startsWith('file:../packages/'))
    .map((spec) => spec.replace('file:../packages/', ''));
}

// The build context per service, as docker compose declares it. Only a repo-root context can see
// packages/ at all, so this is half of the requirement rather than a detail.
function composeContexts(): Record<string, string> {
  const compose = read('docker-compose.yml');
  const contexts: Record<string, string> = {};
  let service: string | null = null;
  for (const line of compose.split('\n')) {
    const serviceMatch = /^ {2}([a-z0-9_-]+):\s*$/.exec(line);
    if (serviceMatch) service = serviceMatch[1];
    const contextMatch = /^\s+context:\s*(\S+)\s*$/.exec(line);
    if (contextMatch && service) contexts[service] = contextMatch[1];
  }
  return contexts;
}

describe('v37: every image installs the shared packages it imports', () => {
  const workspaces = serviceWorkspaces();
  const consumers = workspaces.filter((workspace) => sharedDependenciesOf(workspace).length > 0);

  it('finds the services and the consumers, so the checks below are not vacuous', () => {
    expect(workspaces.length).toBeGreaterThan(0);
    expect(consumers.length).toBeGreaterThan(0);
  });

  for (const workspace of consumers) {
    it(`${workspace} copies and installs each shared package it declares`, () => {
      const content = read(workspace, 'Dockerfile');
      expect(content, `${workspace} must copy packages/ or the file: specs cannot resolve`)
        .toContain('COPY packages/');
      for (const name of sharedDependenciesOf(workspace)) {
        // Each needs its own install: the package is consumed through dist, which its own install builds.
        expect(content, `${workspace}/Dockerfile must install packages/${name}`)
          .toContain(`cd packages/${name} && npm install`);
      }
    });

    it(`${workspace} is built from the repo root, or packages/ is not in its context`, () => {
      const context = composeContexts()[workspace];
      expect(context, `${workspace} has no build context in docker-compose.yml`).toBeDefined();
      expect(['.', './'], `${workspace} needs the repo root as its context`).toContain(context);
    });
  }
});

describe('v37: the backend image ships what it orchestrates', () => {
  it('carries every registered bank workspace, since setup runs npm --prefix there', () => {
    const banks = JSON.parse(read('backend/data/bankInstances.json')) as Array<{ bankInstanceWorkspace: string }>;
    expect(banks.length).toBeGreaterThan(0);
    const content = read('backend/Dockerfile');
    for (const { bankInstanceWorkspace } of banks) {
      expect(content, `backend/Dockerfile must install ${bankInstanceWorkspace}`)
        .toContain(`cd ${bankInstanceWorkspace} && npm install`);
      expect(content, `backend/Dockerfile must copy ${bankInstanceWorkspace}/`)
        .toContain(`COPY ${bankInstanceWorkspace}/ ${bankInstanceWorkspace}/`);
    }
  });

  it('keeps the shared package sources out of the ignore list, dist aside', () => {
    const ignored = read('.dockerignore')
      .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    // Excluding the built output is deliberate (it is rebuilt inside the image); excluding the sources
    // would make every COPY packages/ silently produce an empty directory.
    expect(ignored).not.toContain('packages/');
    expect(ignored).not.toContain('packages');
    expect(ignored).toContain('packages/*/dist/');
  });

  it('pins the same crypt_shared version in both images, since they share a key vault', () => {
    const version = /crypt_shared_v1-linux-[a-z0-9_]+-enterprise-ubuntu2204-([0-9.]+)\.tgz/;
    const backendVersion = version.exec(read('backend/Dockerfile'))?.[1];
    const bankcoreVersion = version.exec(read('bankcore/Dockerfile'))?.[1];
    expect(backendVersion).toBeDefined();
    // A mismatch between two services against one key vault surfaces as a generic 503.
    expect(bankcoreVersion).toBe(backendVersion);
  });
});
