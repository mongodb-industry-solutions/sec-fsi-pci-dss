'use client';
import { useCallback, useEffect, useState } from 'react';
import { HelpCircle, Plus, X, Send, CheckCircle2, Clock } from 'lucide-react';
import { api, type CustomerQuestion } from '../lib/api';
import { useNotify } from './ui/ConfirmProvider';

// ADR-031: L1/L2 panel to pose structured questions to the customer on a fraud case and
// see their (immutable) responses. The customer answers on their transaction page.
export function CaseQuestionsPanel({ caseId, token, role, onActivity, refreshSignal }: { caseId: string; token: string; role: string; onActivity?: () => void; refreshSignal?: number }) {
  const notify = useNotify();
  const canWrite = role === 'level1_analyst' || role === 'level2_investigator';
  const [questions, setQuestions] = useState<CustomerQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState('');
  const [options, setOptions] = useState<string[]>(['Yes', 'No']);
  const [allowOther, setAllowOther] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setQuestions((await api.fraud.getQuestions(caseId, token)).questions); }
    catch { setQuestions([]); }
    finally { setLoading(false); }
  }, [caseId, token]);
  // Reload on mount and whenever the live stream signals a change (SSE).
  useEffect(() => { load(); }, [load, refreshSignal]);

  function setOpt(i: number, v: string) { setOptions((o) => o.map((x, j) => (j === i ? v : x))); }
  function addOpt() { setOptions((o) => [...o, '']); }
  function removeOpt(i: number) { setOptions((o) => o.filter((_, j) => j !== i)); }

  async function create() {
    const clean = options.map((o) => o.trim()).filter(Boolean);
    if (!text.trim()) { notify('Enter the question.', 'error'); return; }
    if (clean.length === 0) { notify('Add at least one response option.', 'error'); return; }
    setCreating(true);
    try {
      await api.fraud.createQuestion(caseId, { questionText: text.trim(), options: clean, allowOther }, token);
      setText(''); setOptions(['Yes', 'No']); setAllowOther(true);
      notify('Question sent to the customer.', 'success');
      await load();
      onActivity?.();
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setCreating(false); }
  }

  return (
    <div className="bg-white rounded-xl border p-5 space-y-4">
      <div className="flex items-center gap-2">
        <HelpCircle size={16} className="text-[#001E2B]" />
        <h2 className="font-semibold text-sm text-gray-800">Customer questions</h2>
        <span className="text-[10px] text-gray-400 ml-auto">answers are immutable (PCI DSS)</span>
      </div>

      {canWrite && (
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500}
            placeholder="Question for the customer, e.g. Did you perform this operation?"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <div>
            <p className="text-[11px] text-gray-500 mb-1">Response options</p>
            <div className="space-y-1.5">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={opt} onChange={(e) => setOpt(i, e.target.value)} maxLength={80}
                    placeholder={`Option ${i + 1}`} className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                  <button onClick={() => removeOpt(i)} className="text-gray-400 hover:text-red-600 p-1"><X size={14} /></button>
                </div>
              ))}
            </div>
            <button onClick={addOpt} className="mt-1.5 inline-flex items-center gap-1 text-xs text-[#001E2B] hover:underline"><Plus size={12} /> Add option</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={allowOther} onChange={(e) => setAllowOther(e.target.checked)} className="accent-[#00ED64]" />
            Allow an &quot;Other&quot; free-text answer
          </label>
          <button onClick={create} disabled={creating}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] font-medium disabled:opacity-50">
            <Send size={14} /> {creating ? 'Sending…' : 'Ask customer'}
          </button>
        </div>
      )}

      {/* Existing questions + responses */}
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : questions.length === 0 ? (
        <p className="text-xs text-gray-400">No questions have been raised on this case.</p>
      ) : (
        <ul className="space-y-2">
          {questions.map((q) => (
            <li key={q.questionId} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-gray-900">{q.questionText}</p>
                {q.status === 'closed'
                  ? <span className="inline-flex items-center gap-1 text-xs text-green-700 shrink-0"><CheckCircle2 size={13} /> Answered</span>
                  : <span className="inline-flex items-center gap-1 text-xs text-amber-700 shrink-0"><Clock size={13} /> Pending</span>}
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">Options: {q.options.join(', ')}{q.allowOther ? ', Other' : ''}</p>
              {q.status === 'closed' && (
                <div className="mt-2 text-sm text-gray-700 bg-green-50 border border-green-200 rounded p-2">
                  <span className="text-gray-500">Customer answered: </span><span className="font-medium">{q.responseOption}</span>
                  {q.responseText && <p className="mt-1 text-gray-700">{q.responseText}</p>}
                  {q.respondedDateTime && <p className="text-xs text-gray-400 mt-1">{new Date(q.respondedDateTime).toLocaleString()}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
