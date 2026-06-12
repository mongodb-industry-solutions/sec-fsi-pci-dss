'use client';
import { useState, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../../../../lib/constants';
import { getAdminToken, readSSE, LogEntry, downloadText } from '../../../../lib/adminHelpers';
import { Download, Copy, CheckCheck, CheckCircle2, XCircle } from 'lucide-react';

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

/** Formats elapsed milliseconds as `12s` or `2m 05s`. */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

const TEST_COMMANDS = new Set(['test', 'test:unit', 'test:integration']);

interface TestCount { passed: number; failed: number; total: number; }
interface TestFailure { title: string; reason?: string; }
interface TestSummaryData {
  files?: TestCount;
  tests?: TestCount;
  duration?: string;
  failures: TestFailure[];
}

/** Pulls a `N failed | M passed (T)` style count out of a vitest summary line. */
function parseCount(line: string): TestCount {
  const failed = /(\d+)\s+failed/.exec(line);
  const passed = /(\d+)\s+passed/.exec(line);
  const total  = /\((\d+)\)/.exec(line);
  const f = failed ? Number(failed[1]) : 0;
  const p = passed ? Number(passed[1]) : 0;
  return { failed: f, passed: p, total: total ? Number(total[1]) : f + p };
}

/**
 * Parses streamed (ANSI-stripped) vitest output into headline stats and a list of
 * failures with their reasons, so the UI can surface them without scrolling the log.
 */
function parseTestResults(logs: LogEntry[]): TestSummaryData {
  const lines = logs.map((l) => l.text);
  const summary: TestSummaryData = { failures: [] };
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/Test Files/.test(line) && /(passed|failed)/.test(line)) {
      summary.files = parseCount(line);
    } else if (/\bTests\b/.test(line) && /(passed|failed)/.test(line)) {
      summary.tests = parseCount(line);
    }

    const dur = /Duration\s+([\d.]+\s*m?s)/.exec(line);
    if (dur) summary.duration = dur[1].replace(/\s+/g, '');

    // " FAIL  test/path.test.ts > suite > name"  (uppercase FAIL is vitest's failure marker)
    const fail = /(?:^|\s)FAIL\s+(.+)$/.exec(line);
    if (fail) {
      const title = fail[1].replace(/\s*\[\s*.+\s*\]\s*$/, '').trim();
      if (!seen.has(title)) {
        seen.add(title);
        let reason: string | undefined;
        for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
          if (/(?:[A-Z][a-zA-Z]*Error|Error):\s*\S/.test(lines[j])) {
            reason = lines[j].trim();
            break;
          }
        }
        summary.failures.push({ title, reason });
      }
    }
  }

  return summary;
}

export default function SetupPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [commandStatus, setCommandStatus] = useState<null | 'success' | 'failure'>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<CommandDef | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  // The command that produced the current output (activeCommand is cleared on finish).
  const [lastCommand, setLastCommand] = useState<string | null>(null);

  // Tick a live clock while a command runs so the elapsed time updates.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

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
    setLastCommand(commandId);
    setCommandStatus(null);
    setLogs([]);
    setStartedAt(Date.now());
    setNow(Date.now());
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
      setNow(Date.now()); // freeze elapsed at the final value
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

  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  // Latest meaningful line drives the "current activity" label.
  const currentStep =
    [...logs].reverse().find((e) => e.type !== 'done' && e.text.trim())?.text ?? 'Starting…';

  // For finished test runs, surface parsed pass/fail stats above the raw log.
  const isTest = !!lastCommand && TEST_COMMANDS.has(lastCommand);
  const testSummary = isTest && !running && commandStatus ? parseTestResults(logs) : null;

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
        {/* Right column - test summary (when applicable) + output panel */}
        <div className="min-h-[280px] lg:flex-1 lg:min-h-0 min-w-0 flex flex-col gap-4">
          {testSummary && <TestSummary summary={testSummary} status={commandStatus} />}
          <div className="flex-1 min-h-0">
            <LogPanel
              title={activeCommand ? `npm run ${activeCommand}` : 'Output'}
              logs={logs}
              endRef={logsEndRef}
              status={commandStatus}
              running={running}
              elapsedMs={elapsedMs}
              currentStep={currentStep}
              onClear={() => { setLogs([]); setCommandStatus(null); setStartedAt(null); }}
              onDownload={() => downloadText(`setup-${activeCommand ?? 'output'}-${Date.now()}.txt`, logs.map((e) => e.text).join('\n'))}
            />
          </div>
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

function LogPanel({ title, logs, endRef, onClear, onDownload, status, running, elapsedMs, currentStep }: {
  title: string;
  logs: LogEntry[];
  endRef: React.RefObject<HTMLDivElement | null>;
  onClear: () => void;
  onDownload: () => void;
  status: null | 'success' | 'failure';
  running: boolean;
  elapsedMs: number;
  currentStep: string;
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
      {(running || (status && elapsedMs > 0)) && (
        <div className="px-4 py-2.5 border-b border-gray-800 bg-gray-950/60">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-xs font-mono text-gray-400 min-w-0 flex-1 flex items-center gap-2">
              {running && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00ED64] animate-pulse flex-shrink-0" />
              )}
              <span className="truncate min-w-0">{running ? currentStep : 'Finished'}</span>
            </span>
            <span className="text-xs font-mono text-gray-500 tabular-nums flex-shrink-0">
              {formatElapsed(elapsedMs)}
            </span>
          </div>
          <div className="relative h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
            {running ? (
              <div className="admin-progress-sweep" />
            ) : (
              <div
                className={`absolute inset-0 rounded-full ${
                  status === 'success' ? 'bg-[#00ED64]' : 'bg-red-500'
                }`}
              />
            )}
          </div>
        </div>
      )}
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

function StatTile({ label, value, sub, tone }: {
  label: string;
  value: number | string;
  sub: string;
  tone: 'pass' | 'fail' | 'neutral';
}) {
  const valueColor =
    tone === 'fail' ? 'text-red-400' :
    tone === 'pass' ? 'text-[#00ED64]' :
    'text-white';
  return (
    <div className="rounded-lg bg-gray-950 border border-gray-800 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${valueColor}`}>{value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5 truncate">{sub}</p>
    </div>
  );
}

function TestSummary({ summary, status }: {
  summary: TestSummaryData;
  status: null | 'success' | 'failure';
}) {
  const { tests, files, duration, failures } = summary;
  const ok = status === 'success';
  const failedCount = tests?.failed ?? failures.length;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex-shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {ok
            ? <CheckCircle2 size={18} className="text-[#00ED64]" />
            : <XCircle size={18} className="text-red-500" />}
          <h3 className="text-sm font-semibold text-white">Test Results</h3>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          ok ? 'bg-[#00ED64]/15 text-[#00ED64]' : 'bg-red-500/15 text-red-400'
        }`}>
          {ok ? 'All passed' : `${failedCount} failed`}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile
          label="Tests"
          value={tests?.total ?? 0}
          sub={`${tests?.passed ?? 0} passed · ${tests?.failed ?? 0} failed`}
          tone={tests?.failed ? 'fail' : 'pass'}
        />
        <StatTile
          label="Files"
          value={files?.total ?? 0}
          sub={`${files?.passed ?? 0} passed · ${files?.failed ?? 0} failed`}
          tone={files?.failed ? 'fail' : 'pass'}
        />
        <StatTile label="Duration" value={duration ?? '—'} sub="wall clock" tone="neutral" />
      </div>

      {failures.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1.5">
            Failures ({failures.length})
          </p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#ef4444_#111827] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-red-500/40 [&::-webkit-scrollbar-thumb]:rounded-full">
            {failures.map((f, i) => (
              <div key={i} className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2">
                <p className="text-xs font-mono text-red-300 break-all">{f.title}</p>
                {f.reason && (
                  <p className="text-[11px] font-mono text-gray-400 mt-1 break-all">{f.reason}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
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
