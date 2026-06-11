'use client';
import { useState, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../../../../lib/constants';
import { getAdminToken, readSSE, LogEntry, downloadText } from '../../../../lib/adminHelpers';
import { Download, Copy, CheckCheck } from 'lucide-react';

const SETUP_LOGS_KEY = 'admin_setup_logs';

interface CommandDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  group: 'setup' | 'test' | 'danger';
  confirmMessage?: string;
  confirmLabel?: string;
}

const COMMANDS: CommandDef[] = [
  { id: 'setup',            label: 'Full Setup',        description: 'Install all dependencies (frontend + backend)',    icon: '📦', group: 'setup' },
  { id: 'setup:key',        label: 'Generate Key',      description: 'Generate the local master encryption key',         icon: '🔑', group: 'setup' },
  { id: 'setup:db',         label: 'Setup Database',    description: 'Create collections, indexes, and provision DEKs', icon: '🗄️', group: 'setup' },
  { id: 'setup:generate',   label: 'Generate Data',     description: 'Generate synthetic demo dataset',                  icon: '🎲', group: 'setup' },
  { id: 'setup:seed',       label: 'Seed Database',     description: 'Insert generated data into MongoDB Atlas',         icon: '🌱', group: 'setup' },
  { id: 'setup:check',     label: 'Validate Setup',    description: 'Check env vars, collections, indexes, DEKs, and Atlas roles are provisioned', icon: '✅', group: 'setup' },
  { id: 'test',             label: 'All Tests',         description: 'Run unit + integration test suites',               icon: '🧪', group: 'test'  },
  { id: 'test:unit',        label: 'Unit Tests',        description: 'Run unit tests only',                              icon: '🔬', group: 'test'  },
  { id: 'test:integration', label: 'Integration Tests', description: 'Run integration tests only',                       icon: '🔗', group: 'test'  },
  { id: 'type-check',       label: 'Type Check',        description: 'TypeScript type check (no emit)',                  icon: '📐', group: 'test'  },
  {
    id: 'setup:db:drop',
    label: 'Drop Everything',
    description: 'Drop all collections, key vault, indexes, Atlas roles and DB users',
    icon: '🗑️',
    group: 'danger',
    confirmMessage: 'This will permanently delete all collections, the QE key vault, all indexes, and Atlas custom roles and DB users. All data will be lost. This cannot be undone.',
    confirmLabel: 'Drop Everything',
  },
];

export default function SetupPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [commandStatus, setCommandStatus] = useState<null | 'success' | 'failure'>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<CommandDef | null>(null);

  // Restore logs from sessionStorage on mount.
  // setLogs + setLogsLoaded are batched by React 18 into one render,
  // so the persist effect below never runs with stale [] before load completes.
  useEffect(() => {
    const saved = sessionStorage.getItem(SETUP_LOGS_KEY);
    if (saved) {
      try { setLogs(JSON.parse(saved)); } catch { /* ignore corrupt data */ }
    }
    setLogsLoaded(true);
  }, []);

  // Persist logs after load is complete. Remove the key when empty (e.g. after Clear).
  useEffect(() => {
    if (!logsLoaded) return;
    if (logs.length === 0) sessionStorage.removeItem(SETUP_LOGS_KEY);
    else sessionStorage.setItem(SETUP_LOGS_KEY, JSON.stringify(logs));
  }, [logs, logsLoaded]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function runCommand(commandId: string) {
    const token = getAdminToken();
    if (running || !token) return;
    setRunning(true);
    setActiveCommand(commandId);
    setCommandStatus(null);
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
        setCommandStatus('failure');
        return;
      }
      await readSSE(res, (type, text) => {
        if (type === 'done') {
          const match = /code\s+(\d+)/i.exec(text);
          setCommandStatus(match?.[1] === '0' ? 'success' : 'failure');
        }
        setLogs((prev) => [...prev, { type: type as LogEntry['type'], text }]);
      });
    } finally {
      setRunning(false);
      setActiveCommand(null);
    }
  }

  function handleRun(id: string) {
    const cmd = COMMANDS.find((c) => c.id === id);
    if (cmd?.confirmMessage) {
      setPendingConfirm(cmd);
      return;
    }
    runCommand(id);
  }

  const setupCmds  = COMMANDS.filter((c) => c.group === 'setup');
  const testCmds   = COMMANDS.filter((c) => c.group === 'test');
  const dangerCmds = COMMANDS.filter((c) => c.group === 'danger');

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-6 lg:h-full">
        {/* Left column - command list */}
        <div className="flex-shrink-0 space-y-4 lg:w-1/2 lg:overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#00ED64_#111827] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#00ED64]/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-[#00ED64]/60">
          <CommandGroup label="Setup" cmds={setupCmds} activeCommand={activeCommand} running={running} onRun={handleRun} />
          <CommandGroup label="Test & Quality" cmds={testCmds} activeCommand={activeCommand} running={running} onRun={handleRun} />
          {dangerCmds.length > 0 && (
            <DangerCommandGroup cmds={dangerCmds} activeCommand={activeCommand} running={running} onRun={handleRun} />
          )}
        </div>
        {/* Right column - output panel fills remaining height */}
        <div className="min-h-[280px] lg:flex-1 lg:min-h-0">
          <LogPanel
            title={activeCommand ? `npm run ${activeCommand}` : 'Output'}
            logs={logs}
            endRef={logsEndRef}
            status={commandStatus}
            onClear={() => { setLogs([]); setCommandStatus(null); }}
            onDownload={() => downloadText(`setup-${activeCommand ?? 'output'}-${Date.now()}.txt`, logs.map((e) => e.text).join('\n'))}
          />
        </div>
      </div>

      {pendingConfirm && (
        <ConfirmModal
          cmd={pendingConfirm}
          onConfirm={() => {
            const id = pendingConfirm.id;
            setPendingConfirm(null);
            runCommand(id);
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </>
  );
}

function CommandGroup({ label, cmds, activeCommand, running, onRun }: {
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

function LogPanel({ title, logs, endRef, onClear, onDownload, status }: {
  title: string;
  logs: LogEntry[];
  endRef: React.RefObject<HTMLDivElement | null>;
  onClear: () => void;
  onDownload: () => void;
  status: null | 'success' | 'failure';
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = logs.map((e) => (e.type === 'error' ? '[ERR] ' : '') + e.text).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col h-[50vh] lg:h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950">
        <span className="text-xs font-mono text-gray-400 truncate">{title}</span>
        <div className="flex items-center gap-3 ml-2 flex-shrink-0">
          <button
            onClick={handleCopy}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors"
            title="Copy all output to clipboard"
          >
            {copied ? <CheckCheck size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={onDownload}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors"
            title="Download output"
          >
            <Download size={12} /> Download
          </button>
          <button onClick={onClear} className="text-xs text-gray-600 hover:text-gray-400">Clear</button>
        </div>
      </div>
      {status && (
        <div className={`px-4 py-2 flex items-center gap-2 text-xs font-semibold border-b ${
          status === 'success'
            ? 'bg-green-900/30 border-green-800/50 text-green-400'
            : 'bg-red-900/30 border-red-800/50 text-red-400'
        }`}>
          {status === 'success'
            ? '✓ Command completed successfully (exit code 0)'
            : '✗ Command failed, check output above for details'}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5 [scrollbar-width:thin] [scrollbar-color:#00ED64_#111827] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-gray-900 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#00ED64]/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-[#00ED64]/70 [&::-webkit-scrollbar-corner]:bg-gray-900">
        {logs.length === 0 && <div className="text-gray-600 italic">Select a command to run...</div>}
        {logs.map((e, i) => (
          <div key={i} className={
            e.type === 'error'            ? 'text-red-400' :
            e.type === 'start'            ? 'text-orange-400 font-semibold' :
            e.type === 'done'             ? 'text-green-400 font-semibold' :
            e.text.includes('[FAIL]')     ? 'text-red-400' :
            e.text.includes('[WARN]')     ? 'text-yellow-400' :
            e.text.includes('[PASS]')     ? 'text-green-400' :
            e.text.includes('[SKIP]')     ? 'text-gray-500' :
            'text-gray-300'
          }>
            {e.type === 'error' ? '[ERR] ' : ''}{e.text}
          </div>
        ))}
        <div ref={endRef as React.RefObject<HTMLDivElement>} />
      </div>
    </div>
  );
}

function DangerCommandGroup({ cmds, activeCommand, running, onRun }: {
  cmds: CommandDef[];
  activeCommand: string | null;
  running: boolean;
  onRun: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">Danger Zone</p>
      <div className="space-y-1.5">
        {cmds.map((cmd) => (
          <button
            key={cmd.id}
            onClick={() => onRun(cmd.id)}
            disabled={running}
            className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-all ${
              activeCommand === cmd.id
                ? 'border-red-500 bg-red-500/10'
                : 'border-red-900/50 bg-gray-900 hover:border-red-700 hover:bg-red-950/30'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span className="text-lg mt-0.5">{cmd.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-red-400 text-sm">{cmd.label}</span>
                <code className="text-xs text-gray-500 font-mono">npm run {cmd.id}</code>
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
  );
}

function ConfirmModal({ cmd, onConfirm, onCancel }: {
  cmd: CommandDef;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-gray-900 border border-red-900/60 rounded-xl p-6 max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <span className="text-xl mt-0.5">⚠️</span>
          <div>
            <h2 className="text-white font-bold text-base">Confirm Destructive Operation</h2>
            <p className="text-gray-400 text-xs mt-0.5">This action cannot be undone.</p>
          </div>
        </div>

        <div className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 mb-4">
          <code className="text-red-400 text-xs font-mono">npm run {cmd.id}</code>
        </div>

        <p className="text-gray-300 text-sm mb-6 leading-relaxed">{cmd.confirmMessage}</p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 text-sm hover:border-gray-500 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
          >
            {cmd.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
