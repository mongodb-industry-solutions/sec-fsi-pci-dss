import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../../config';

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
  return resolve(__dirname, '../../../..');
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

// Runs one npm script across every registered bank. Skipped entirely while the kill switch is off,
// so a PSP-only deployment never builds a database it does not use.
export async function forEachBank(script: 'setup:db' | 'setup:seed' | 'setup:check' | 'setup:db:drop', args: string[] = []): Promise<void> {
  if (!config.bankcore.enabled) {
    console.log(`  skip:    bankcore ${script} (PSP_BANKCORE_ENABLED is false)`);
    return;
  }
  const instances = bankInstances();
  if (instances.length === 0) {
    console.log('  skip:    no bank instance registered in data/bankInstances.json');
    return;
  }
  for (const instance of instances) {
    console.log(`\n  bank:    ${instance.bankInstanceName} (${instance.bankInstanceWorkspace}) → ${script}`);
    await runScript(instance.bankInstanceWorkspace, script, args);
  }
}
