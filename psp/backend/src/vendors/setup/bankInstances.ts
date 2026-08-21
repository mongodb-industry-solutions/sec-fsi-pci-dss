import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Registered bank instances, as data. Adding a bank is a record here plus its own database, never a
// change to the setup entry point.
export interface BankInstance {
  bankInstanceReference: string;
  bankInstanceName: string;
  // Workspace directory relative to the repo root, holding that bank's own setup and seed.
  bankInstanceWorkspace: string;
  // Environment variable naming its database, so two instances never share one.
  bankInstanceDbNameVariable: string;
}

function repoRoot(): string {
  return resolve(__dirname, '../../../../..');
}

export function bankInstances(): BankInstance[] {
  const file = resolve(__dirname, '../../../data/bankInstances.json');
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')) as BankInstance[];
}

function runScript(workspace: string, script: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    // Allowlisted script name plus flags only: nothing here is composed from user input.
    const child = spawn('npm', ['run', script, '--prefix', workspace, ...(args.length ? ['--', ...args] : [])], {
      cwd: repoRoot(),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? done() : fail(new Error(`${workspace}: npm run ${script} exited with ${code}`))));
  });
}

// Runs one npm script across every registered bank.
//
// Deliberately NOT gated on PSP_BANKCORE_ENABLED. The kill switch governs runtime behaviour, which
// bank the PSP talks to; building and seeding a database it does not yet read costs nothing and is
// inert. Gating setup on it produced the opposite of a safe default: a half-built split that looks
// fine until someone flips the flag and only then discovers the bank has no accounts. Dropping is
// gated even less, since the PSP drop takes the SHARED key vault with it and a surviving bank
// database would keep QE collections pointing at DEKs that no longer exist.
export async function forEachBank(script: 'setup:db' | 'setup:seed' | 'setup:check' | 'setup:db:drop', args: string[] = []): Promise<void> {
  const instances = bankInstances();
  if (instances.length === 0) {
    console.log('  skip:    no bank instance registered in data/bankInstances.json');
    return;
  }
  for (const instance of instances) {
    console.log(`\n  bank:    ${instance.bankInstanceName} (${instance.bankInstanceWorkspace}) → ${script}`);
    // A registered bank whose workspace is not in the image is a packaging defect, and npm reports it
    // as a path error that reads like a broken script. Name the actual cause instead.
    const workspace = resolve(repoRoot(), instance.bankInstanceWorkspace);
    if (!existsSync(resolve(workspace, 'package.json'))) {
      throw new Error(
        `${instance.bankInstanceWorkspace} is registered as a bank but its workspace is not present at `
        + `${workspace}. This image must ship it, since setup is orchestrated from here.`,
      );
    }
    await runScript(instance.bankInstanceWorkspace, script, args);
  }
}
