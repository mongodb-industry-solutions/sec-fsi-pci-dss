'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, NoteEntry } from '../lib/api';
import { StickyNote, Plus, Trash2, X } from 'lucide-react';

interface Props {
  caseId: string;
  token: string;
  role: string;
  // Called after a note is added or retracted so the parent can refresh the case activity log
  // in place (a note add/retract is itself an auditable event).
  onActivity?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  level1_analyst: 'L1 Analyst',
  level2_investigator: 'L2 Investigator',
  security_auditor: 'Security Auditor',
  payment_service: 'System',
};

export function CaseNotesPanel({ caseId, token, role, onActivity }: Props) {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [visibility, setVisibility] = useState<'internal' | 'customer'>('internal');
  const [confirmAdd, setConfirmAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Retraction modal state
  const [retractTarget, setRetractTarget] = useState<NoteEntry | null>(null);
  const [retractionReason, setRetractionReason] = useState('');

  const canWrite = role === 'level1_analyst' || role === 'level2_investigator';

  const loadNotes = useCallback(async () => {
    try {
      const res = await api.fraud.getNotes(caseId, token);
      setNotes(res.notes);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [caseId, token]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  async function submitNote() {
    setBusy(true);
    setMsg(null);
    try {
      await api.fraud.addNote(caseId, { noteText, visibility }, token);
      setNoteText('');
      setShowAddForm(false);
      setConfirmAdd(false);
      await loadNotes();
      onActivity?.();
      setMsg('Note added.');
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  function handleAddClick() {
    if (!noteText.trim()) return;
    if (visibility === 'customer') {
      setConfirmAdd(true);
    } else {
      submitNote();
    }
  }

  async function submitRetraction() {
    if (!retractTarget) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.fraud.retractNote(caseId, retractTarget.noteId, { retractionReason: retractionReason || undefined }, token);
      setRetractTarget(null);
      setRetractionReason('');
      await loadNotes();
      onActivity?.();
      setMsg('Note retracted.');
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  const internalNotes = notes.filter((n) => n.visibility === 'internal');
  const customerNotes = notes.filter((n) => n.visibility === 'customer');

  return (
    <div className="bg-white rounded-xl border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm text-gray-700 flex items-center gap-2">
          <StickyNote size={14} className="text-gray-400" />
          Case Notes
        </h2>
        {canWrite && (
          <button
            onClick={() => { setShowAddForm((v) => !v); setMsg(null); }}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {showAddForm ? <X size={12} /> : <Plus size={12} />}
            {showAddForm ? 'Cancel' : 'Add note'}
          </button>
        )}
      </div>

      {/* Add note form */}
      {showAddForm && (
        <div className="border rounded-lg p-3 space-y-2 bg-gray-50">
          <div className="flex gap-2">
            <button
              onClick={() => setVisibility('internal')}
              className={`flex-1 py-1.5 text-xs rounded-md font-medium border transition-colors ${visibility === 'internal' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
            >
              Internal
            </button>
            <button
              onClick={() => setVisibility('customer')}
              className={`flex-1 py-1.5 text-xs rounded-md font-medium border transition-colors ${visibility === 'customer' ? 'bg-green-700 text-white border-green-700' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
            >
              Customer-visible
            </button>
          </div>
          {visibility === 'customer' && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
              This note will be visible to the customer in their transaction history. Once added it cannot be edited - only retracted.
            </p>
          )}
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            placeholder={visibility === 'internal' ? 'Add context for the investigation team...' : 'e.g. Your transaction is under security review. No action needed.'}
            className="w-full border rounded-md px-3 py-2 text-sm resize-none bg-white"
          />
          <button
            onClick={handleAddClick}
            disabled={busy || !noteText.trim()}
            className="w-full py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save note'}
          </button>
        </div>
      )}

      {/* Customer-visible note confirmation modal */}
      {confirmAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900">Confirm customer-visible note</h3>
            <p className="text-sm text-gray-600">
              This note will be <strong>immediately visible to the customer</strong>. It cannot be edited after saving - only retracted (which creates an audit event).
            </p>
            <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-gray-800 whitespace-pre-wrap">{noteText}</div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmAdd(false)}
                className="flex-1 py-2 rounded-lg border text-gray-700 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitNote}
                disabled={busy}
                className="flex-1 py-2 rounded-lg bg-green-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Confirm & save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retraction confirmation modal */}
      {retractTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900">Retract note</h3>
            <p className="text-sm text-gray-600">
              Retraction is <strong>permanent and auditable</strong> - the original note will remain in the audit log marked as retracted. The note will no longer be shown.
            </p>
            <div className="bg-gray-50 border rounded p-2 text-sm text-gray-600 italic whitespace-pre-wrap line-through">
              {retractTarget.noteText}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason (optional)</label>
              <input
                type="text"
                value={retractionReason}
                onChange={(e) => setRetractionReason(e.target.value)}
                placeholder="e.g. Sent by mistake"
                className="w-full border rounded-md px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setRetractTarget(null); setRetractionReason(''); }}
                className="flex-1 py-2 rounded-lg border text-gray-700 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitRetraction}
                disabled={busy}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? 'Retracting…' : 'Retract note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status message */}
      {msg && (
        <div className={`text-xs rounded px-3 py-2 ${msg.startsWith('Error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {msg}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400">Loading notes…</p>
      ) : (
        <>
          {/* Internal notes */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Internal notes</p>
            {internalNotes.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No internal notes yet.</p>
            ) : (
              <div className="space-y-2">
                {internalNotes.map((note) => (
                  <NoteCard
                    key={note.noteId}
                    note={note}
                    role={role}
                    onRetract={() => setRetractTarget(note)}
                    canWrite={canWrite}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Customer-visible notes */}
          <div>
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Customer-visible notes</p>
            {customerNotes.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No customer-facing notes yet. Add one to keep the customer informed.</p>
            ) : (
              <div className="space-y-2">
                {customerNotes.map((note) => (
                  <NoteCard
                    key={note.noteId}
                    note={note}
                    role={role}
                    onRetract={() => setRetractTarget(note)}
                    canWrite={canWrite}
                    isCustomer
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NoteCard({
  note,
  role,
  onRetract,
  canWrite,
  isCustomer = false,
}: {
  note: NoteEntry;
  role: string;
  onRetract: () => void;
  canWrite: boolean;
  isCustomer?: boolean;
}) {
  const canRetract = canWrite && !note.isRetracted && note.performedByRole === role;

  return (
    <div className={`rounded-lg border p-3 text-sm space-y-1 ${note.isRetracted ? 'opacity-50 bg-gray-50 border-gray-200' : isCustomer ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-gray-800 whitespace-pre-wrap leading-snug ${note.isRetracted ? 'line-through text-gray-500' : ''}`}>
          {note.noteText}
        </p>
        {canRetract && (
          <button
            onClick={onRetract}
            title="Retract note"
            className="shrink-0 p-1 rounded text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span>{ROLE_LABELS[note.performedByRole] ?? note.performedByRole}</span>
        <span>·</span>
        <span>{new Date(note.actionDateTime).toLocaleString()}</span>
        {note.isRetracted && (
          <>
            <span>·</span>
            <span className="text-red-500 font-medium">
              Retracted {note.retractionReason ? `- ${note.retractionReason}` : ''}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
