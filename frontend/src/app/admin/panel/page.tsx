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

type LogEntry = { type: 'log' | 'error' | 'start' | 'done' | 'server'; text: string };

interface CommandDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  priority: 'primary' | 'secondary';
}

const COMMANDS: CommandDef[] = [
  { id: 'setup',            label: 'Full Setup',       description: 'Install all dependencies (frontend + backend)',        icon: '📦', priority: 'primary' },
  { id: 'setup:key',        label: 'Generate Key',     description: 'Generate the local master encryption key',             icon: '🔑', priority: 'primary' },
  { id: 'setup:db',         label: 'Setup Database',   description: 'Create collections, indexes, and provision DEKs',     icon: '🗄️', priority: 'primary' },
  { id: 'setup:generate',   label: 'Generate Data',    description: 'Generate synthetic demo dataset (customers, cards...)', icon: '🎲', priority: 'primary' },
  { id: 'setup:seed',       label: 'Seed Database',    description: 'Insert generated data into MongoDB Atlas',             icon: '🌱', priority: 'primary' },
  { id: 'test',             label: 'All Tests',         description: 'Run unit + integration test suites',                  icon: '🧪', priority: 'secondary' },
  { id: 'test:unit',        label: 'Unit Tests',        description: 'Run unit tests only',                                 icon: '🔬', priority: 'secondary' },
  { id: 'test:integration', label: 'Integration Tests', description: 'Run integration tests only',                          icon: '🔗', priority: 'secondary' },
  { id: 'type-check',       label: 'Type Check',        description: 'TypeScript type check (no emit)',                     icon: '📐', priority: 'secondary' },
];

export default function AdminPanelPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'commands' | 'server-logs'>('commands');
  const [serverLogs, setServerLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const serverLogsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = getAdminToken();
    if (!t) {
      router.push('/admin');
      return;
    }
    setToken(t);
  }, [router]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    serverLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [serverLogs]);

  const streamServerLogs = useCallback(async (t: string) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/logs`, {
        headers: { Authorization: `Bearer ${t}` },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
          if (dataLine) {
            try {
              const { text } = JSON.parse(dataLine.slice(5).trim()) as { text: string };
              setServerLogs((prev) => [...prev.slice(-499), text]);
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch {
      // stream closed or aborted
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'server-logs' && token) {
      setServerLogs([]);
      streamServerLogs(token);
      return () => abortRef.current?.abort();
    }
  }, [activeTab, token, streamServerLogs]);

  async function runCommand(commandId: string) {
    if (running || !token) return;
    setRunning(true);
    setActiveCommand(commandId);
    setLogs([]);

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ command: commandId }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setLogs([{ type: 'error', text: (err as { error?: string }).error ?? 'Request failed' }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const eventLine = part.split('\n').find((l) => l.startsWith('event:'));
          const dataLine  = part.split('\n').find((l) => l.startsWith('data:'));
          if (dataLine) {
            try {
              const type = (eventLine?.slice(6).trim() ?? 'log') as LogEntry['type'];
              const { text } = JSON.parse(dataLine.slice(5).trim()) as { text: string };
              setLogs((prev) => [...prev, { type, text }]);
            } catch { /* skip */ }
          }
        }
      }
    } finally {
      setRunning(false);
      setActiveCommand(null);
    }
  }

  function handleSignOut() {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    router.push('/admin');
  }

  if (!token) {
    return <div className="text-center py-12 text-gray-500">Redirecting...</div>;
  }

  const primaryCommands = COMMANDS.filter((c) => c.priority === 'primary');
  const secondaryCommands = COMMANDS.filter((c) => c.priority === 'secondary');

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
        {(['commands', 'server-logs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === tab
                ? 'bg-gray-800 text-orange-400 border-b-2 border-orange-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab === 'commands' ? 'Setup Commands' : 'Server Logs'}
          </button>
        ))}
      </div>

      {activeTab === 'commands' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Command list */}
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-3">Setup Commands</h2>
              <div className="space-y-2">
                {primaryCommands.map((cmd) => (
                  <button
                    key={cmd.id}
                    onClick={() => runCommand(cmd.id)}
                    disabled={running}
                    className={`w-full text-left flex items-start gap-3 p-4 rounded-xl border transition-all ${
                      activeCommand === cmd.id
                        ? 'border-orange-500 bg-orange-500/10'
                        : 'border-gray-800 bg-gray-900 hover:border-gray-600 hover:bg-gray-800'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <span className="text-xl mt-0.5">{cmd.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
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

            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Test Commands</h2>
              <div className="space-y-2">
                {secondaryCommands.map((cmd) => (
                  <button
                    key={cmd.id}
                    onClick={() => runCommand(cmd.id)}
                    disabled={running}
                    className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-all ${
                      activeCommand === cmd.id
                        ? 'border-orange-500 bg-orange-500/10'
                        : 'border-gray-800 bg-gray-900 hover:border-gray-600 hover:bg-gray-800'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <span className="text-lg mt-0.5">{cmd.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-300 text-sm">{cmd.label}</span>
                        <code className="text-xs text-gray-600 font-mono">npm run {cmd.id}</code>
                        {activeCommand === cmd.id && running && (
                          <span className="text-xs text-orange-400 animate-pulse">Running...</span>
                        )}
                      </div>
                      <p className="text-gray-500 text-xs mt-0.5">{cmd.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Log output */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col h-[600px]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950">
              <span className="text-xs font-mono text-gray-400">
                {activeCommand ? `Running: npm run ${activeCommand}` : 'Output'}
              </span>
              <button
                onClick={() => setLogs([])}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5">
              {logs.length === 0 && (
                <div className="text-gray-600 italic">Select a command to run...</div>
              )}
              {logs.map((entry, i) => (
                <div
                  key={i}
                  className={
                    entry.type === 'error' ? 'text-red-400' :
                    entry.type === 'start' ? 'text-orange-400 font-semibold' :
                    entry.type === 'done'  ? 'text-green-400 font-semibold' :
                    'text-gray-300'
                  }
                >
                  {entry.type === 'error' ? '[ERR] ' : entry.type === 'done' ? '[DONE] ' : ''}
                  {entry.text}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'server-logs' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col h-[600px]">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950">
            <span className="text-xs font-mono text-gray-400">
              Server logs (live stream · last 500 entries)
            </span>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs text-green-500">Live</span>
              <button
                onClick={() => setServerLogs([])}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors ml-2"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5">
            {serverLogs.length === 0 && (
              <div className="text-gray-600 italic">Connecting to log stream...</div>
            )}
            {serverLogs.map((line, i) => (
              <div key={i} className={
                line.includes('"level":50') || line.includes('error') ? 'text-red-400' :
                line.includes('"level":40') || line.includes('warn')  ? 'text-yellow-400' :
                'text-gray-300'
              }>
                {line}
              </div>
            ))}
            <div ref={serverLogsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
