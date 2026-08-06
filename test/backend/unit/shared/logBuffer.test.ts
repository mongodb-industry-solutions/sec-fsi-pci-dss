/**
 * Unit tests: backend/src/shared/services/logBuffer.ts
 * The admin logs panel is the investigation surface, so every failure path must land in the ring
 * buffer: pino warn+ entries, console.warn/error from background work, and error objects rendered
 * as type + capped message (PCI DSS / GDPR: no full stacks).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logBuffer,
  appendLog,
  appendLogEntry,
  levelLabel,
  mirrorConsoleToLogBuffer,
} from '../../../../backend/src/shared/services/logBuffer';

function reset() {
  logBuffer.length = 0;
}

describe('levelLabel', () => {
  it('maps pino numeric levels to labels', () => {
    expect(levelLabel(40)).toBe('WARN');
    expect(levelLabel(50)).toBe('ERROR');
    expect(levelLabel(60)).toBe('FATAL');
  });
});

describe('appendLogEntry', () => {
  beforeEach(reset);

  it('renders an Error as name + message, never a stack', () => {
    appendLogEntry('ERROR', [new Error('boom')]);
    const line = logBuffer.at(-1)!;
    expect(line).toContain('ERROR Error: boom');
    expect(line).not.toContain('at ');
  });

  it('unwraps the pino { err } wrapper so the cause is visible', () => {
    appendLogEntry('ERROR', [{ err: new TypeError('bad field') }, 'request failed']);
    expect(logBuffer.at(-1)).toContain('TypeError: bad field request failed');
  });

  it('collapses newlines and caps the line length', () => {
    appendLogEntry('WARN', ['a\nb', 'x'.repeat(1000)]);
    const line = logBuffer.at(-1)!;
    expect(line).toContain('a b');
    // timestamp + kind prefix plus the 500-char cap on the rendered arguments
    expect(line.length).toBeLessThan(560);
  });

  it('survives an unserializable argument', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    appendLogEntry('ERROR', [circular]);
    expect(logBuffer.at(-1)).toContain('[unserializable]');
  });
});

// The spies are installed once, BEFORE the mirror, and kept for the whole block: the mirror wraps
// whatever console method exists at install time, so re-spying afterwards would bypass it.
describe('mirrorConsoleToLogBuffer', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  mirrorConsoleToLogBuffer();

  beforeEach(reset);
  afterEach(() => { warnSpy.mockClear(); errorSpy.mockClear(); });

  it('mirrors console.error and console.warn into the buffer and still calls through', () => {
    console.error('[payout-orch] Failed to trigger payout for txn t-1:', new Error('rail down'));
    console.warn('[users] party phone read degraded (QE)');

    expect(logBuffer.some((l) => l.includes('CONSOLE ERROR') && l.includes('rail down'))).toBe(true);
    expect(logBuffer.some((l) => l.includes('CONSOLE WARN') && l.includes('degraded'))).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('is idempotent, so a second install cannot double-wrap and duplicate entries', () => {
    mirrorConsoleToLogBuffer();
    console.error('once');
    expect(logBuffer.filter((l) => l.includes('once')).length).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('appendLog ring buffer', () => {
  beforeEach(reset);

  it('keeps at most 500 entries', () => {
    for (let i = 0; i < 520; i++) appendLog(`line-${i}`);
    expect(logBuffer.length).toBe(500);
    expect(logBuffer[0]).toBe('line-20');
  });
});
