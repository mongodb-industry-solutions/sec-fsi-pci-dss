// v37 P0.8: first file in the bankcore test tree, so it asserts the wiring itself. Without it a
// suite added later could sit unexecuted and look green.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../..');

describe('v37 P0.8: bankcore test tree', () => {
  it('runs under the repo runner, which is what executing this file proves', () => {
    expect(true).toBe(true);
  });

  it('vitest includes both bankcore directories', () => {
    const cfg = readFileSync(resolve(ROOT, 'vitest.config.ts'), 'utf8');
    expect(cfg).toContain('test/bank/backend/unit/**/*.test.ts');
    expect(cfg).toContain('test/bank/backend/integration/**/*.test.ts');
  });

  it('the npm scripts name both directories', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['test:unit']).toContain('test/bank/backend/unit');
    expect(pkg.scripts['test:integration']).toContain('test/bank/backend/integration');
  });
});
