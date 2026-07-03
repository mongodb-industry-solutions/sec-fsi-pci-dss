'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  UserCheck, ArrowLeft, Mail, Phone, Check, Edit3, X, AlertTriangle,
} from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { useDebugMode } from '../../../../lib/debugMode';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';

interface BeneficiaryDetail {
  counterpartyArrangementReference: string;
  ownerPartyReference: string;
  counterpartyPartyReference: string;
  counterpartyLabel: string;
  counterpartyLookupType: 'phone' | 'email';
  counterpartyLookupHint: string;
  counterpartyArrangementStatus: 'active' | 'removed';
  bianServiceDomain: string;
  bianControlRecordType: string;
  recordCreatedDateTime: string;
  recordUpdatedDateTime: string;
  schemaVersion: number;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function BeneficiaryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { debugMode } = useDebugMode();
  const beneficiaryId = params?.beneficiaryId as string;

  const [token, setToken] = useState('');
  const [role, setRole] = useState('');
  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (t) setRole(decodeToken(t)?.role ?? '');
  }, []);

  const canWrite = role === 'level2_investigator' || role === 'security_auditor';

  const [record, setRecord] = useState<BeneficiaryDetail | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!token || !beneficiaryId) return;
    api.beneficiaries.get(beneficiaryId, token)
      .then(setRecord)
      .catch(err => setLoadError(err instanceof Error ? err.message : 'Failed to load beneficiary.'));
  }, [token, beneficiaryId]);

  // Label edit state
  const [editLabel, setEditLabel] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelError, setLabelError] = useState('');
  const [labelSaved, setLabelSaved] = useState(false);

  function openEdit() {
    setLabelValue(record?.counterpartyLabel ?? '');
    setLabelError('');
    setLabelSaved(false);
    setEditLabel(true);
  }

  async function saveLabel() {
    if (!record || !labelValue.trim()) { setLabelError('Label cannot be empty.'); return; }
    setLabelSaving(true);
    setLabelError('');
    try {
      await api.beneficiaries.updateLabel(
        record.ownerPartyReference,
        record.counterpartyArrangementReference,
        labelValue.trim(),
        token,
      );
      setRecord(prev => prev ? { ...prev, counterpartyLabel: labelValue.trim() } : prev);
      setLabelSaved(true);
      setEditLabel(false);
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : 'Failed to save label.');
    }
    setLabelSaving(false);
  }

  if (loadError) {
    return (
      <div className="w-full px-5 sm:px-8 py-6">
        <button type="button" onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle size={16} /> {loadError}
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="w-full px-5 sm:px-8 py-6">
        <div className="text-sm text-gray-400">Loading…</div>
      </div>
    );
  }

  const isActive = record.counterpartyArrangementStatus === 'active';

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <button type="button" onClick={() => router.push('/system/beneficiaries')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft size={14} /> Beneficiaries
      </button>

      <SectionHeader
        icon={UserCheck}
        title={record.counterpartyLabel}
        description="Beneficiary contact entry — BIAN SD-54 Counterparty Administration"
        debugInfo={`counterpartyArrangementReference: ${record.counterpartyArrangementReference} · schemaVersion: ${record.schemaVersion}`}
      />

      {/* Status banner for removed records */}
      {!isActive && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle size={15} className="shrink-0" />
          This beneficiary has been removed and is no longer active. The record is retained for audit compliance.
        </div>
      )}

      {/* Alias / Label card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-gray-800 text-sm">Alias</h2>
            <p className="text-xs text-gray-500 mt-0.5">Owner-defined display name for this contact.</p>
          </div>
          {canWrite && isActive && !editLabel && (
            <button type="button" onClick={openEdit}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors">
              <Edit3 size={12} /> Edit
            </button>
          )}
        </div>

        {editLabel ? (
          <div className="space-y-3">
            <input
              value={labelValue}
              onChange={e => setLabelValue(e.target.value)}
              maxLength={80}
              placeholder="e.g. Mom, Landlord, Business Partner"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setEditLabel(false); }}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{80 - labelValue.length} chars remaining</span>
              <div className="flex items-center gap-2">
                {labelError && <span className="text-xs text-red-600">{labelError}</span>}
                <button type="button" onClick={() => setEditLabel(false)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors">
                  <X size={11} /> Cancel
                </button>
                <button type="button" onClick={saveLabel} disabled={labelSaving || !labelValue.trim()}
                  className="flex items-center gap-1 text-xs font-medium bg-[#001E2B] hover:bg-[#001E2B]/80 text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50">
                  {labelSaving ? 'Saving…' : <><Check size={11} /> Save</>}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-2xl font-semibold text-gray-900">{record.counterpartyLabel}</span>
            {labelSaved && (
              <span className="inline-flex items-center gap-1 text-xs text-green-600">
                <Check size={12} /> Saved
              </span>
            )}
          </div>
        )}
      </div>

      {/* Contact & party details */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 text-sm mb-4">Contact details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Lookup type</dt>
            <dd className="flex items-center gap-1.5 font-medium text-gray-800">
              {record.counterpartyLookupType === 'email'
                ? <><Mail size={13} className="text-blue-400" /> Email</>
                : <><Phone size={13} className="text-green-400" /> Phone</>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Masked contact hint</dt>
            <dd className="font-mono text-sm text-gray-800">{record.counterpartyLookupHint}</dd>
            <dd className="text-[10px] text-gray-400 mt-0.5">Raw PII not stored (PCI DSS Req 3.4)</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Status</dt>
            <dd>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {record.counterpartyArrangementStatus}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Owner party reference</dt>
            <dd className="font-mono text-xs text-gray-700 break-all">{record.ownerPartyReference}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Counterparty party reference</dt>
            <dd className="font-mono text-xs text-gray-700 break-all">{record.counterpartyPartyReference}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Arrangement reference</dt>
            <dd className="font-mono text-xs text-gray-700 break-all">{record.counterpartyArrangementReference}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Registered</dt>
            <dd className="text-gray-700">{fmtDateTime(record.recordCreatedDateTime)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Last updated</dt>
            <dd className="text-gray-700">{fmtDateTime(record.recordUpdatedDateTime)}</dd>
          </div>
        </dl>
      </div>

      {/* BIAN metadata */}
      {debugMode && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-3">BIAN metadata</h2>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
            <div>
              <dt className="text-gray-500">Service Domain</dt>
              <dd className="font-medium text-gray-700">{record.bianServiceDomain}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Control Record Type</dt>
              <dd className="font-medium text-gray-700">{record.bianControlRecordType}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Schema Version</dt>
              <dd className="font-medium text-gray-700">{record.schemaVersion}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
