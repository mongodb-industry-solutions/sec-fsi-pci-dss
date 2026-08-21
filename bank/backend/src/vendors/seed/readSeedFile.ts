import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../../config';

// Seed fixtures are plain JSON in bankcore/data/, same format and naming as backend/data/, and they
// stay environment agnostic: no hostname ever lands in a fixture.
export function seedDataDir(): string {
  return config.app.seedDataDir ?? resolve(__dirname, '../../../data');
}

export function readSeedFile<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(seedDataDir(), name), 'utf8')) as T;
}
