'use client';
import { useState, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../../../../lib/constants';
import { getAdminToken, readSSE, LogEntry } from '../../../../lib/adminHelpers';

interface CommandDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  group: 'setup' | 'test';
}

const COMMANDS: CommandDef[] = [
  { id: 'setup',            label: 'Full Setup',        description: 'Install all dependencies (frontend + backend)',    icon: '📦', group: 'setup' },
  { id: 'setup:key',        label: 'Generate Key',      description: 'Generate the local master encryption key',         icon: '🔑', group: 'setup' },
  { id: 'setup:db',         label: 'Setup Database',    description: 'Create collections, indexes, and provision DEKs', icon: '🗄️', group: 'setup' },
  { id: 'setup:generate',   label: 'Generate Data',     description: 'Generate synthetic demo dataset',                  icon: '🎲', group: 'setup' },
  { id: 'setup:seed',       label: 'Seed Database',     description: 'Insert generated data into MongoDB Atlas',         icon: '🌱', group: 'setup' },
  { id: 'test',             label: 'All Tests',         description: 'Run unit + integration test suites',               icon: '🧪', group: 'test'  },
  { id: 'test:unit',        label: 'Unit Tests',        description: 'Run unit tests only',                              icon: '🔬', group: 'test'  },
  { id: 'test:integration', label: 'Integration Tests', description: 'Run integration tests only',                       icon: '🔗', group: 'test'  },
  { id: 'type-check',       label: 'Type Check',        description: 'TypeScript type check (no emit)',                  icon: '📐', group: 'test'  },
];

export default function SetupPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function runCommand(commandId: string) {
    const token = getAdminToken();
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

  const setupCmds = COMMANDS.filter((c) => c.group === 'setup');
  const testCmds  = COMMANDS.filter((c) => c.group === 'test');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <CommandGroup label="Setup" cmds={setupCmds} activeCommand={activeCommand} running={running} onRun={runCommand} />
        <CommandGroup label="Test & Quality" cmds={testCmds} activeCommand={activeCommand} running={running} onRun={runCommand} />
      </div>
      <LogPanel title={activeCommand ? `npm run ${activeCommand}` : 'Output'} logs={logs} endRef={logsEndRef} onClear={() => setLogs([])} />
    </div>
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

function LogPanel({ title, logs, endRef, onClear }: {
  title: string;
  logs: LogEntry[];
  endRef: React.RefObject<HTMLDivElement | null>;
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
            {e.type === 'error' ? '[ERR] ' : ''}{e.text}
          </div>
        ))}
        <div ref={endRef as React.RefObject<HTMLDivElement>} />
      </div>
    </div>
  );
}
