'use client';
import { useCallback, useEffect, useState } from 'react';
import { HelpCircle, CheckCircle2, Send } from 'lucide-react';
import { api, type CustomerQuestion } from '../lib/api';
import { useNotify } from './ui/ConfirmProvider';

// ADR-031: customer-facing question/response section, shown on a transaction below the security
// notes. Questions are posed by L1/L2 investigators (SD-83); the customer picks a predefined option
// or "Other" (free text). Once submitted, the response is immutable (PCI DSS Req 10).
export function CustomerQuestionsPanel({ txnId, token, onAnswered }: { txnId: string; token: string; onAnswered?: () => void }) {
  const notify = useNotify();
  const [questions, setQuestions] = useState<CustomerQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { option: string; text: string }>>({});

  const load = useCallback(async () => {
    if (!token || !txnId) return;
    setLoading(true);
    try { setQuestions((await api.transactions.getQuestions(txnId, token)).questions); }
    catch { setQuestions([]); }
    finally { setLoading(false); }
  }, [txnId, token]);
  useEffect(() => { load(); }, [load]);

  function setDraft(qid: string, patch: Partial<{ option: string; text: string }>) {
    setDrafts((d) => {
      const cur = d[qid] ?? { option: '', text: '' };
      return { ...d, [qid]: { ...cur, ...patch } };
    });
  }

  async function submit(q: CustomerQuestion) {
    const draft = drafts[q.questionId];
    if (!draft?.option) { notify('Please select an answer.', 'error'); return; }
    if (draft.option === 'Other' && !draft.text.trim()) { notify('Please describe your answer.', 'error'); return; }
    setBusy(q.questionId);
    try {
      await api.transactions.answerQuestion(txnId, q.questionId, { option: draft.option, text: draft.option === 'Other' ? draft.text.trim() : undefined }, token);
      notify('Response submitted.', 'success');
      await load();
      onAnswered?.();
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }

  if (loading || questions.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border p-5 space-y-4 mb-4">
      <div className="flex items-center gap-2">
        <HelpCircle size={16} className="text-[#001E2B]" />
        <h2 className="font-semibold text-gray-800">Questions from the security team</h2>
      </div>
      <p className="text-xs text-gray-500">
        Your answer helps the investigation. Responses are recorded and cannot be changed once submitted.
      </p>

      {questions.map((q) => {
        const draft = drafts[q.questionId] ?? { option: '', text: '' };
        const isClosed = q.status === 'closed';
        const isBusy = busy === q.questionId;
        return (
          <div key={q.questionId} className={`rounded-lg border p-4 ${isClosed ? 'border-gray-200 bg-gray-50' : 'border-blue-200 bg-blue-50/40'}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-gray-900">{q.questionText}</p>
              {isClosed
                ? <span className="inline-flex items-center gap-1 text-xs text-green-700 shrink-0"><CheckCircle2 size={13} /> Answered</span>
                : <span className="text-xs text-amber-700 shrink-0">Awaiting your response</span>}
            </div>

            {isClosed ? (
              <div className="mt-2 text-sm text-gray-700">
                <span className="text-gray-500">Your answer: </span>
                <span className="font-medium">{q.responseOption}</span>
                {q.responseText && <p className="mt-1 text-gray-600 bg-white border border-gray-200 rounded p-2 text-sm">{q.responseText}</p>}
                {q.respondedDateTime && <p className="text-xs text-gray-400 mt-1">{new Date(q.respondedDateTime).toLocaleString()}</p>}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {q.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="radio" name={`q-${q.questionId}`} checked={draft.option === opt} onChange={() => setDraft(q.questionId, { option: opt })} className="accent-[#001E2B]" />
                    {opt}
                  </label>
                ))}
                {q.allowOther && (
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="radio" name={`q-${q.questionId}`} checked={draft.option === 'Other'} onChange={() => setDraft(q.questionId, { option: 'Other' })} className="accent-[#001E2B]" />
                    Other
                  </label>
                )}
                {q.allowOther && draft.option === 'Other' && (
                  <textarea value={draft.text} onChange={(e) => setDraft(q.questionId, { text: e.target.value })} rows={2} maxLength={1000}
                    placeholder="Describe your answer…" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                )}
                <button onClick={() => submit(q)} disabled={isBusy || !draft.option}
                  className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] font-medium disabled:opacity-50">
                  <Send size={14} /> {isBusy ? 'Submitting…' : 'Submit response'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
