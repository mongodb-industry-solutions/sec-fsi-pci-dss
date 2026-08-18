// v37 P1.4: the reset path across both databases.
//
// The trap this pins down: `npm run setup:db -- --reset` at the repo root used to expand to
// `npm run setup:db --prefix backend --reset`, where npm consumes `--reset` as one of ITS OWN options
// and the flag never reaches bin/setup.ts. The reset silently did a plain setup. A trailing `--` in
// the delegating script is what forwards it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');

function scripts(workspace = '.'): Record<string, string> {
  return JSON.parse(readFileSync(resolve(ROOT, workspace, 'package.json'), 'utf8')).scripts;
}

describe('v37: reset wiring', () => {
  it('every delegating root script forwards its arguments', () => {
    const root = scripts();
    for (const name of ['setup:db', 'setup:db:drop', 'setup:check', 'setup:seed']) {
      expect(root[name].trimEnd().endsWith('--'), `${name} must end with -- to forward flags`).toBe(true);
    }
  });

  it('the root offers an explicit reset that carries the flag', () => {
    expect(scripts()['setup:db:reset']).toContain('-- --reset');
    // A full reset is the database rebuild followed by the seed, in that order.
    expect(scripts()['setup:reset']).toBe('npm run setup:db:reset && npm run setup:seed');
  });

  it('bankcore mirrors the backend reset entry', () => {
    expect(scripts('bankcore')['setup:db:reset']).toContain('--reset');
    expect(scripts('backend')['setup:db']).toContain('bin/setup.ts');
  });

  it('the root setup installs the shared packages and bankcore, or a fresh clone cannot reset', () => {
    const setup = scripts()['setup'];
    for (const workspace of ['packages/eventbus', 'packages/platform-links', 'backend', 'bankcore', 'frontend', 'merchant']) {
      expect(setup, `${workspace} must be installed by npm run setup`).toContain(workspace);
    }
  });

  it('the PSP entry points orchestrate every bank, and the drop runs before the key vault goes', () => {
    const setupBin = readFileSync(resolve(ROOT, 'backend/bin/setup.ts'), 'utf8');
    const seedBin = readFileSync(resolve(ROOT, 'backend/bin/seed.ts'), 'utf8');
    const dropBin = readFileSync(resolve(ROOT, 'backend/bin/setup-drop.ts'), 'utf8');

    // Setup: PSP first, then the banks, carrying --reset through.
    expect(setupBin).toMatch(/runSetup\(reset\)[\s\S]*forEachBank\('setup:db', reset \? \['--reset'\] : \[\]\)/);
    // Seed: bank BEFORE the PSP, since the PSP holds the references.
    expect(seedBin.indexOf("forEachBank('setup:seed')")).toBeLessThan(seedBin.indexOf('runSeed()'));
    // Drop: bank BEFORE the PSP, because the PSP drop takes the shared key vault with it.
    expect(dropBin.indexOf("forEachBank('setup:db:drop')")).toBeLessThan(dropBin.indexOf('runDrop()'));
  });

  it('the bank drop is not gated on the kill switch', () => {
    // Leaving a bank database behind while the shared key vault is dropped is a broken state, and it
    // only surfaces later as an opaque decryption failure.
    const orchestrator = readFileSync(resolve(ROOT, 'backend/src/vendors/setup/bankInstances.ts'), 'utf8');
    expect(orchestrator).toContain("RUNS_REGARDLESS_OF_FLAG = new Set(['setup:db:drop'])");
  });

  it('the bank drop never touches the shared key vault', () => {
    const drop = readFileSync(resolve(ROOT, 'bankcore/src/vendors/setup/dropAll.ts'), 'utf8');
    expect(drop).toContain('dropDatabase()');
    // Dropping it would take the PSP's DEKs with it.
    expect(drop).not.toMatch(/keyVault[\s\S]{0,40}dropDatabase/);
  });
});
