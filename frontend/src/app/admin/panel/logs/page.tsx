'use client';
import { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { API_BASE_URL } from '../../../../lib/constants';
import { getAdminToken, LogEntry, downloadText } from '../../../../lib/adminHelpers';
import { Download, Copy, CheckCheck, Play, Square } from 'lucide-react';

// ---------------------------------------------------------------------------
//  Module-level stream manager — persists across tab switches (mount/unmount)
// ---------------------------------------------------------------------------

const LOGS_KEY = 'admin_server_logs';
const MAX_LOGS = 1000;
const PERSIST_LIMIT = 500;

let _logs: LogEntry[] = (() => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(sessionStorage.getItem(LOGS_KEY) ?? '[]'); } catch { return []; }
})();
let _streaming = false;
let _controller: AbortController | null = null;
const _listeners = new Set<() => void>();

function _notify() { _listeners.forEach((fn) => fn()); }

function _push(entry: LogEntry) {
  _logs = [..._logs.slice(-(MAX_LOGS - 1)), entry];
  sessionStorage.setItem(LOGS_KEY, JSON.stringify(_logs.slice(-PERSIST_LIMIT)));
  _notify();
}

async function _start() {
  const token = getAdminToken();
  if (!token || _streaming) return;

  _controller = new AbortController();
  _streaming = true;
  _notify();

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/logs`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: _controller.signal,
    });
    if (!res.ok || !res.body) {
      _push({ type: 'error', text: `HTTP ${res.status}: ${res.statusText}` });
      _streaming = false; _controller = null; _notify();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6)) as { text?: string };
          if (payload.text) _push({ type: 'log', text: payload.text });
        } catch { /* skip malformed */ }
      }
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') { /* expected */ }
    else _push({ type: 'error', text: String(err) });
  } finally {
    _streaming = false;
    _controller = null;
    _notify();
  }
}

function _stop() {
  _controller?.abort();
  _controller = null;
  _streaming = false;
  _notify();
}

function _clear() {
  _logs = [];
  sessionStorage.removeItem(LOGS_KEY);
  _notify();
}

function subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}
function getLogsSnapshot() { return _logs; }
function getStreamingSnapshot() { return _streaming; }

// ---------------------------------------------------------------------------
//  Component — subscribes to the module-level store via useSyncExternalStore
// ---------------------------------------------------------------------------

export default function LogsPage() {
  const logs = useSyncExternalStore(subscribe, getLogsSnapshot, () => []);
  const streaming = useSyncExternalStore(subscribe, getStreamingSnapshot, () => false);

  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  function handleCopy() {
    const text = logs.map((e) => e.text).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const filtered = filter
    ? logs.filter((e) => e.text.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  return (
    <div className="flex flex-col h-[65vh] lg:h-full bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-400">Server Logs</span>
          {streaming && (
            <span className="inline-flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              live
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="bg-gray-800 text-xs text-gray-300 px-2 py-1 rounded border border-gray-700 focus:outline-none focus:border-gray-500 w-32"
          />
          <button
            onClick={streaming ? _stop : _start}
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
              streaming
                ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                : 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
            }`}
          >
            {streaming ? <><Square size={10} /> Stop</> : <><Play size={10} /> Stream</>}
          </button>
          <button
            onClick={handleCopy}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors"
            title="Copy all output"
          >
            {copied ? <CheckCheck size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={() => downloadText(`server-logs-${Date.now()}.txt`, logs.map((e) => e.text).join('\n'))}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors"
            title="Download logs"
          >
            <Download size={12} /> Download
          </button>
          <button onClick={_clear} className="text-xs text-gray-600 hover:text-gray-400">Clear</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5 [scrollbar-width:thin] [scrollbar-color:#00ED64_#111827] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-gray-900 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#00ED64]/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-[#00ED64]/70 [&::-webkit-scrollbar-corner]:bg-gray-900">
        {filtered.length === 0 && !streaming && (
          <div className="text-gray-600 italic">
            Click &quot;Stream&quot; to start receiving server logs in real time...
          </div>
        )}
        {filtered.length === 0 && streaming && (
          <div className="text-gray-500 animate-pulse">Waiting for log entries...</div>
        )}
        {filtered.map((e, i) => (
          <div key={i} className={e.type === 'error' ? 'text-red-400' : 'text-gray-200'}>
            {e.text}
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
