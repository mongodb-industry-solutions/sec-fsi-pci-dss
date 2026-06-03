'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { API_BASE_URL } from '../../../lib/constants';

const ADMIN_TOKEN_KEY = 'admin_token';

function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

type LogEntry = { type: 'log' | 'error' | 'start' | 'done'; text: string };
type TabId = 'commands' | 'terminal' | 'server-logs' | 'system';

interface CommandDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  group: 'setup' | 'test';
}

const COMMANDS: CommandDef[] = [
  { id: 'setup',            label: 'Full Setup',        description: 'Install all dependencies (frontend + backend)',         icon: '📦', group: 'setup' },
  { id: 'setup:key',        label: 'Generate Key',      description: 'Generate the local master encryption key',              icon: '🔑', group: 'setup' },
  { id: 'setup:db',         label: 'Setup Database',    description: 'Create collections, indexes, and provision DEKs',      icon: '🗄️', group: 'setup' },
  { id: 'setup:generate',   label: 'Generate Data',     description: 'Generate synthetic demo dataset',                      icon: '🎲', group: 'setup' },
  { id: 'setup:seed',       label: 'Seed Database',     description: 'Insert generated data into MongoDB Atlas',              icon: '🌱', group: 'setup' },
  { id: 'test',             label: 'All Tests',          description: 'Run unit + integration test suites',                   icon: '🧪', group: 'test'  },
  { id: 'test:unit',        label: 'Unit Tests',         description: 'Run unit tests only',                                  icon: '🔬', group: 'test'  },
  { id: 'test:integration', label: 'Integration Tests',  description: 'Run integration tests only',                           icon: '🔗', group: 'test'  },
  { id: 'type-check',       label: 'Type Check',         description: 'TypeScript type check (no emit)',                      icon: '📐', group: 'test'  },
];

interface SystemInfo {
  os: Record<string, unknown>;
  node: Record<string, unknown>;
  package: Record<string, unknown>;
  env: Record<string, string>;
}

export default function AdminPanelPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('commands');

  // Command runner state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Terminal state
  const [termInput, setTermInput] = useState('');
  const [termLogs, setTermLogs] = useState<LogEntry[]>([]);
  const [termRunning, setTermRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const termEndRef = useRef<HTMLDivElement>(null);
  const termInputRef = useRef<HTMLInputElement>(null);

  // Server logs state
  const [serverLogs, setServerLogs] = useState<string[]>([]);
  const serverLogsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // System info state
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [sysLoading, setSysLoading] = useState(false);
  const [sysError, setSysError] = useState<string | null>(null);
  const [envFilter, setEnvFilter] = useState('');

  useEffect(() => {
    const t = getAdminToken();
    if (!t) { router.push('/admin'); return; }
    setToken(t);
  }, [router]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    termEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [termLogs]);

  useEffect(() => {
    serverLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [serverLogs]);

  // Stream helper
  async function readSSE(
    res: Response,
    onEntry: (type: string, text: string) => void,
  ) {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const eventLine = part.split('\n').find((l) => l.startsWith('event:'));
        const dataLine  = part.split('\n').find((l) => l.startsWith('data:'));
        if (dataLine) {
          try {
            const type = eventLine?.slice(6).trim() ?? 'log';
            const { text } = JSON.parse(dataLine.slice(5).trim()) as { text: string };
            onEntry(type, text);
          } catch { /* skip malformed frame */ }
        }
      }
    }
  }

  // Run predefined npm command
  async function runCommand(commandId: string) {
    if (running || !token) return;
    setRunning(true);
    setActiveCommand(commandId);
    setLogs([]);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: commandId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setLogs([{ type: 'error', text: (err as { error?: string }).error ?? 'Request failed' }]);
        return;
      }
      await readSSE(res, (type, text) =>
        setLogs((prev) => [...prev, { type: type as LogEntry['type'], text }])
      );
    } finally {
      setRunning(false);
      setActiveCommand(null);
    }
  }

  // Execute arbitrary shell command
  async function execCommand(cmd: string) {
    if (termRunning || !token || !cmd.trim()) return;
    const trimmed = cmd.trim();
    setHistory((h) => [trimmed, ...h.slice(0, 49)]);
    setHistoryIdx(-1);
    setTermInput('');
    setTermRunning(true);
    setTermLogs((prev) => [...prev, { type: 'start', text: `$ ${trimmed}` }]);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setTermLogs((prev) => [...prev, { type: 'error', text: (err as { error?: string }).error ?? 'Failed' }]);
        return;
      }
      await readSSE(res, (type, text) => {
        if (type !== 'start') {
          setTermLogs((prev) => [...prev, { type: type as LogEntry['type'], text }]);
        }
      });
    } finally {
      setTermRunning(false);
    }
  }

  function handleTermKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { execCommand(termInput); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHistoryIdx((i) => {
        const next = Math.min(i + 1, history.length - 1);
        if (history[next] !== undefined) setTermInput(history[next]);
        return next;
      });
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHistoryIdx((i) => {
        const next = Math.max(i - 1, -1);
        setTermInput(next === -1 ? '' : (history[next] ?? ''));
        return next;
      });
    }
  }

  // Server logs SSE
  const streamServerLogs = useCallback(async (t: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/logs`, {
        headers: { Authorization: `Bearer ${t}` },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) return;
      await readSSE(res, (_type, text) =>
        setServerLogs((prev) => [...prev.slice(-499), text])
      );
    } catch { /* stream closed or aborted */ }
  }, []);

  useEffect(() => {
    if (activeTab === 'server-logs' && token) {
      setServerLogs([]);
      streamServerLogs(token);
      return () => abortRef.current?.abort();
    }
  }, [activeTab, token, streamServerLogs]);

  // System info fetch
  async function fetchSysInfo() {
    if (!token) return;
    setSysLoading(true);
    setSysError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/system`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? res.statusText);
      setSysInfo(await res.json() as SystemInfo);
    } catch (err) {
      setSysError((err as Error).message);
    } finally {
      setSysLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'system' && token && !sysInfo) fetchSysInfo();
  }, [activeTab, token]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSignOut() {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    router.push('/admin');
  }

  if (!token) return <div className="text-center py-12 text-gray-500">Redirecting...</div>;

  const TABS: { id: TabId; label: string; icon: string }[] = [
    { id: 'commands',    label: 'Setup Commands', icon: '📦' },
    { id: 'terminal',    label: 'Terminal',        icon: '>' },
    { id: 'server-logs', label: 'Server Logs',    icon: '📋' },
    { id: 'system',      label: 'System Info',    icon: 'ℹ️' },
  ];

  const setupCmds = COMMANDS.filter((c) => c.group === 'setup');
  const testCmds  = COMMANDS.filter((c) => c.group === 'test');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage demo environment setup and monitoring</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Back to Home
          </Link>
          <button
            onClick={handleSignOut}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'bg-gray-800 text-orange-400 border-b-2 border-orange-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* ── Setup Commands ── */}
      {activeTab === 'commands' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <CommandGroup label="Setup" cmds={setupCmds} activeCommand={activeCommand} running={running} onRun={runCommand} />
            <CommandGroup label="Test & Quality" cmds={testCmds} activeCommand={activeCommand} running={running} onRun={runCommand} />
          </div>
          <LogPanel title={activeCommand ? `npm run ${activeCommand}` : 'Output'} logs={logs} endRef={logsEndRef} onClear={() => setLogs([])} />
        </div>
      )}

      {/* ── Terminal ── */}
      {activeTab === 'terminal' && (
        <div className="flex flex-col h-[600px] bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950">
            <span className="text-xs font-mono text-gray-400">Shell · project root</span>
            <button onClick={() => setTermLogs([])} className="text-xs text-gray-600 hover:text-gray-400">Clear</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5">
            {termLogs.length === 0 && (
              <div className="text-gray-600 italic">Type a command below and press Enter...</div>
            )}
            {termLogs.map((e, i) => (
              <div key={i} className={
                e.type === 'error' ? 'text-red-400' :
                e.type === 'start' ? 'text-orange-300 font-semibold' :
                e.type === 'done'  ? 'text-green-400' :
                'text-gray-200'
              }>{e.text}</div>
            ))}
            {termRunning && <div className="text-gray-500 animate-pulse">...</div>}
            <div ref={termEndRef} />
          </div>
          <div className="border-t border-gray-800 px-4 py-2 flex items-center gap-2 bg-gray-950">
            <span className="text-orange-400 font-mono text-sm">$</span>
            <input
              ref={termInputRef}
              type="text"
              value={termInput}
              onChange={(e) => { setTermInput(e.target.value); setHistoryIdx(-1); }}
              onKeyDown={handleTermKey}
              disabled={termRunning}
              placeholder="Enter any shell command..."
              className="flex-1 bg-transparent text-sm font-mono text-gray-100 placeholder-gray-600 focus:outline-none disabled:opacity-40"
              autoFocus
            />
            <button
              onClick={() => execCommand(termInput)}
              disabled={termRunning || !termInput.trim()}
              className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1 rounded disabled:opacity-30 transition-colors"
            >
              Run
            </button>
          </div>
        </div>
      )}

      {/* ── Server Logs ── */}
      {activeTab === 'server-logs' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col h-[600px]">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950">
            <span className="text-xs font-mono text-gray-400">Request log · live stream · last 500 entries</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs text-green-400">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Live
              </span>
              <button onClick={() => setServerLogs([])} className="text-xs text-gray-600 hover:text-gray-400">Clear</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5">
            {serverLogs.length === 0 && <div className="text-gray-600 italic">Connecting to log stream...</div>}
            {serverLogs.map((line, i) => (
              <div key={i} className={
                line.includes('"level":50') || /\b(error|ERR)\b/i.test(line) ? 'text-red-400' :
                line.includes('"level":40') || /\b(warn)\b/i.test(line)  ? 'text-yellow-400' :
                line.includes('5') && / -> 5\d\d/.test(line) ? 'text-red-400' :
                line.includes(' -> 4') ? 'text-yellow-400' :
                'text-gray-300'
              }>{line}</div>
            ))}
            <div ref={serverLogsEndRef} />
          </div>
        </div>
      )}

      {/* ── System Info ── */}
      {activeTab === 'system' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={fetchSysInfo}
              disabled={sysLoading}
              className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded disabled:opacity-40 transition-colors"
            >
              {sysLoading ? 'Refreshing...' : 'Refresh'}
            </button>
            {sysError && <span className="text-xs text-red-400">{sysError}</span>}
          </div>

          {sysInfo && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* OS */}
              <InfoCard title="Operating System" icon="💻">
                {Object.entries(sysInfo.os).map(([k, v]) => (
                  <InfoRow key={k} label={k} value={String(v)} />
                ))}
              </InfoCard>

              {/* Node.js */}
              <InfoCard title="Node.js Runtime" icon="🟢">
                {Object.entries(sysInfo.node).map(([k, v]) => (
                  <InfoRow key={k} label={k} value={String(v)} />
                ))}
              </InfoCard>

              {/* package.json */}
              <InfoCard title="package.json" icon="📦">
                {Object.entries(sysInfo.package).map(([k, v]) =>
                  k === 'scripts' ? (
                    <div key={k} className="col-span-2 mt-2">
                      <p className="text-gray-500 text-xs font-semibold uppercase mb-1">scripts</p>
                      {Object.entries(v as Record<string, string>).map(([sk, sv]) => (
                        <div key={sk} className="flex gap-2 text-xs py-0.5 border-b border-gray-800">
                          <code className="text-orange-400 min-w-[120px]">{sk}</code>
                          <code className="text-gray-400 truncate">{sv}</code>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <InfoRow key={k} label={k} value={
                      Array.isArray(v) ? (v as string[]).join(', ') : String(v)
                    } />
                  )
                )}
              </InfoCard>

              {/* Environment vars */}
              <InfoCard title="Environment Variables" icon="⚙️">
                <div className="col-span-2 mb-2">
                  <input
                    type="text"
                    value={envFilter}
                    onChange={(e) => setEnvFilter(e.target.value)}
                    placeholder="Filter..."
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none"
                  />
                </div>
                {Object.entries(sysInfo.env)
                  .filter(([k]) => !envFilter || k.toLowerCase().includes(envFilter.toLowerCase()))
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => (
                    <InfoRow key={k} label={k} value={v} mono />
                  ))}
              </InfoCard>
            </div>
          )}

          {!sysInfo && !sysLoading && !sysError && (
            <div className="text-gray-500 text-sm">Loading system info...</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Sub-components ---- */

function CommandGroup({
  label, cmds, activeCommand, running, onRun,
}: {
  label: string;
  cmds: CommandDef[];
  activeCommand: string | null;
  running: boolean;
  onRun: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{label}</p>
      <div className="space-y-1.5">
        {cmds.map((cmd) => (
          <button
            key={cmd.id}
            onClick={() => onRun(cmd.id)}
            disabled={running}
            className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-all ${
              activeCommand === cmd.id
                ? 'border-orange-500 bg-orange-500/10'
                : 'border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-800'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span className="text-lg mt-0.5">{cmd.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-white text-sm">{cmd.label}</span>
                <code className="text-xs text-gray-500 font-mono">npm run {cmd.id}</code>
                {activeCommand === cmd.id && running && (
                  <span className="text-xs text-orange-400 animate-pulse">Running...</span>
                )}
              </div>
              <p className="text-gray-400 text-xs mt-0.5">{cmd.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function LogPanel({
  title, logs, endRef, onClear,
}: {
  title: string;
  logs: LogEntry[];
  endRef: { current: HTMLDivElement | null };
  onClear: () => void;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col h-[540px]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950">
        <span className="text-xs font-mono text-gray-400 truncate">{title}</span>
        <button onClick={onClear} className="text-xs text-gray-600 hover:text-gray-400 ml-2 flex-shrink-0">Clear</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5">
        {logs.length === 0 && <div className="text-gray-600 italic">Select a command to run...</div>}
        {logs.map((e, i) => (
          <div key={i} className={
            e.type === 'error' ? 'text-red-400' :
            e.type === 'start' ? 'text-orange-400 font-semibold' :
            e.type === 'done'  ? 'text-green-400 font-semibold' :
            'text-gray-300'
          }>
            {e.type === 'error' ? '[ERR] ' : e.type === 'done' ? '' : ''}
            {e.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function InfoCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <span>{icon}</span> {title}
      </p>
      <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-xs py-0.5 border-b border-gray-800/60">
      <span className="text-gray-500 min-w-[140px] flex-shrink-0">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} text-gray-300 break-all`}>{value}</span>
    </div>
  );
}
