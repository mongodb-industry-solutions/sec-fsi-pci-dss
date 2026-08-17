import { config } from '../../../config';
import { appendLog } from '../../../shared/services/logBuffer';

// Pulls the bank's ring buffer over the private network and mirrors a failure into the PSP's own
// buffer, so "the bank setup broke" is visible in the panel rather than only in pod logs.
export async function fetchBankcoreLogs(
  limit = 200,
  fetchImpl: typeof fetch = fetch,
): Promise<{ lines: string[]; error?: string }> {
  if (!config.bankcore.enabled) return { lines: [], error: 'PSP_BANKCORE_ENABLED is false' };
  try {
    const response = await fetchImpl(
      `${config.bankcore.baseUrl}/api/v1/system/logs?limit=${limit}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!response.ok) {
      const error = `bankcore logs unavailable: HTTP ${response.status}`;
      appendLog(`[${new Date().toISOString()}] WARN [bankcore] ${error}`);
      return { lines: [], error };
    }
    const body = await response.json() as { lines?: string[] };
    return { lines: body.lines ?? [] };
  } catch (err) {
    const error = `bankcore logs unreachable: ${err instanceof Error ? err.message : String(err)}`;
    appendLog(`[${new Date().toISOString()}] WARN [bankcore] ${error}`);
    return { lines: [], error };
  }
}
