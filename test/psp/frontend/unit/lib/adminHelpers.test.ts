/**
 * Unit tests: frontend/src/lib/adminHelpers.ts
 * Covers the defences added after the admin panel misbehaved in production: proxy bodies that are
 * not JSON ("no healthy upstream"), and an SSE stream that is silently dropped mid-command.
 */
import { describe, it, expect, vi } from 'vitest';
import { readJsonSafe, isUpstreamUnavailable, readSSE } from '../../../../../psp/frontend/src/lib/adminHelpers';

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function sseResponse(frames: string[], opts: { stallForever?: boolean } = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      if (!opts.stallForever) controller.close();
      // stallForever: never close, emulating a proxy that keeps the socket open with no data
    },
  });
  return new Response(stream, { status: 200 });
}

describe('readJsonSafe', () => {
  it('parses a JSON body', async () => {
    const { data, text } = await readJsonSafe<{ ok: boolean }>(textResponse('{"ok":true}'));
    expect(data).toEqual({ ok: true });
    expect(text).toBe('{"ok":true}');
  });

  it('returns the raw text instead of throwing on a proxy error page', async () => {
    const { data, text } = await readJsonSafe(textResponse('no healthy upstream', 503));
    expect(data).toBeNull();
    expect(text).toBe('no healthy upstream');
  });

  it('handles an empty body', async () => {
    const { data, text } = await readJsonSafe(textResponse(''));
    expect(data).toBeNull();
    expect(text).toBe('');
  });
});

describe('isUpstreamUnavailable', () => {
  it('flags only proxy-level unavailability', () => {
    expect(isUpstreamUnavailable(textResponse('x', 502))).toBe(true);
    expect(isUpstreamUnavailable(textResponse('x', 503))).toBe(true);
    expect(isUpstreamUnavailable(textResponse('x', 504))).toBe(true);
    expect(isUpstreamUnavailable(textResponse('x', 200))).toBe(false);
    expect(isUpstreamUnavailable(textResponse('x', 401))).toBe(false);
    expect(isUpstreamUnavailable(textResponse('x', 500))).toBe(false);
  });
});

describe('readSSE', () => {
  it('emits typed entries and ignores heartbeat comment frames', async () => {
    const entries: Array<[string, string]> = [];
    await readSSE(
      sseResponse([
        ': ping\n\n',
        'event: log\ndata: {"text":"Seeding party"}\n\n',
        'event: done\ndata: {"text":"Process exited with code 0"}\n\n',
      ]),
      (type, text) => entries.push([type, text]),
    );
    expect(entries).toEqual([
      ['log', 'Seeding party'],
      ['done', 'Process exited with code 0'],
    ]);
  });

  it('delivers the structured summary frame to onSummary', async () => {
    const summaries: unknown[] = [];
    await readSSE(
      sseResponse(['event: summary\ndata: {"tool":"vitest","total":1,"passed":1,"failed":0,"skipped":0,"durationMs":5,"failures":[]}\n\n']),
      () => {},
      (s) => summaries.push(s),
    );
    expect(summaries).toHaveLength(1);
    expect((summaries[0] as { tool: string }).tool).toBe('vitest');
  });

  it('throws instead of hanging when the stream stalls past the idle timeout', async () => {
    vi.useFakeTimers();
    try {
      const promise = readSSE(
        sseResponse(['event: log\ndata: {"text":"Seeding paymentCardManagement"}\n\n'], { stallForever: true }),
        () => {},
        undefined,
        1000,
      );
      const assertion = expect(promise).rejects.toThrow(/Stream stalled: no output for 1s/);
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not time out when no idle timeout is configured', async () => {
    const entries: string[] = [];
    await readSSE(sseResponse(['event: log\ndata: {"text":"one"}\n\n']), (_t, text) => entries.push(text));
    expect(entries).toEqual(['one']);
  });
});
