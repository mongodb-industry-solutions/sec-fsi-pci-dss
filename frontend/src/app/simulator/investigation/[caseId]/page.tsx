'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, RawDocumentResponse } from '../../../../lib/api';
import { getSimTokenForRole } from '../../../../lib/simulatorAuth';
import { EncryptionBadge } from '../../../../components/EncryptionBadge';
import { RawDocumentPanel } from '../../../../components/RawDocumentPanel';
import { SEVERITY_COLORS, STATUS_COLORS, formatRiskIndicator } from '../../../../lib/constants';

// L1 = level1_analyst, L2 = level2_investigator. The simulator obtains a REAL
// JWT for each role (via /api/v1/auth/login with the demo credential) and drives
// the SAME endpoints application mode uses, so every action here persists to
// MongoDB and is visible when logging into application mode as the matching role.

type StepId = 'l1-open' | 'l1-escalate' | 'l2-review' | 'l2-resolve' | 'customer-view';

interface Step {
  id: StepId;
  label: string;
  role: string;
  icon: string;
  description: string;
}

const STEPS: Step[] = [
  { id: 'l1-open',       label: 'L1 Opens Ticket',      role: 'Level 1 Analyst',      icon: 'person',   description: 'A Level 1 analyst reviews the flagged transaction and opens the fraud investigation ticket.' },
  { id: 'l1-escalate',   label: 'L1 Escalates to L2',   role: 'Level 1 Analyst',      icon: 'escalate', description: 'Risk indicators exceed L1 authority. The analyst escalates the case to Level 2 investigation.' },
  { id: 'l2-review',     label: 'L2 Deep Analysis',     role: 'Level 2 Investigator', icon: 'search',   description: 'A Level 2 investigator approves the escalation and conducts a full forensic review with elevated data access.' },
  { id: 'l2-resolve',    label: 'L2 Resolution',        role: 'Level 2 Investigator', icon: 'check',    description: 'The investigator documents findings and triggers the resolution workflow.' },
  { id: 'customer-view', label: 'Customer Outcome',     role: 'Customer',             icon: 'person',   description: 'The customer receives the outcome of the investigation and the protective actions taken.' },
];

const STEP_ICONS: Record<string, string> = { person: '👤', escalate: '⬆️', search: '🔍', check: '✅' };

type Addr = { streetAddress?: string; city?: string; postalCode?: string; countryCode?: string };

export default function SimulatorCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [customer, setCustomer] = useState<Record<string, unknown> | null>(null);
  const [rawDoc, setRawDoc] = useState<RawDocumentResponse | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<StepId>('l1-open');

  // Real per-role tokens + the escalation token issued on L2 approval.
  const [l2Token, setL2Token] = useState<string>('');
  const [escalationToken, setEscalationToken] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refreshCase = useCallback(async (token: string) => {
    const c = await api.fraud.getById(caseId, token);
    setFraudCase(c);
    return c;
  }, [caseId]);

  useEffect(() => {
    // Initial load uses the public GET (no token needed to read a case).
    api.fraud.getById(caseId, '')
      .then(setFraudCase)
      .catch(() => setFraudCase(null))
      .finally(() => setLoading(false));
  }, [caseId]);

  // ── Real actions ──────────────────────────────────────────────────────────
  async function run(action: () => Promise<void>) {
    setBusy(true); setMsg(null);
    try { await action(); }
    catch (err) { setMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`); }
    finally { setBusy(false); }
  }

  function handleEscalate() {
    return run(async () => {
      const l1 = await getSimTokenForRole('level1_analyst');
      await api.fraud.escalate(caseId, { escalationReason: 'Risk exceeds L1 threshold. Requesting L2 review.' }, l1);
      await refreshCase(l1);
      setMsg('Case escalated to Level 2; persisted in MongoDB.');
      setCurrentStep('l2-review');
    });
  }

  function handleApprove() {
    return run(async () => {
      const l2 = await getSimTokenForRole('level2_investigator');
      setL2Token(l2);
      const res = await api.fraud.escalateApprove(caseId, {}, l2);
      setEscalationToken(res.escalationToken);
      const c = await refreshCase(l2);
      // Load the REAL customer record + raw transaction with elevated access.
      if (c.customerAgreementInstanceReference) {
        api.customer.getById(c.customerAgreementInstanceReference, l2).then(setCustomer).catch(() => null);
      }
      if (c.cardTransactionInstanceReference) {
        api.system.rawDocument('cardTransactionLog', c.cardTransactionInstanceReference, l2)
          .then(setRawDoc).catch(() => null);
      }
      setMsg('Escalation approved. Escalation token issued, sensitive fields unlocked.');
    });
  }

  function handleResolve(outcome: 'confirmed_fraud' | 'cleared') {
    return run(async () => {
      const l2 = l2Token || (await getSimTokenForRole('level2_investigator'));
      await api.fraud.update(
        caseId,
        {
          fraudDiagnosisCaseStatus: outcome === 'confirmed_fraud' ? 'resolved_fraud' : 'resolved_cleared',
          resolutionOutcome: outcome,
          resolutionNotes: outcome === 'confirmed_fraud'
            ? 'Confirmed fraud after forensic review. Card blocked, dispute filed.'
            : 'Cleared after review: legitimate transaction.',
        },
        l2,
      );
      await refreshCase(l2);
      setMsg(`Case resolved as ${outcome === 'confirmed_fraud' ? 'confirmed fraud' : 'cleared'}; persisted.`);
      setCurrentStep('customer-view');
    });
  }

  async function toggleRaw() {
    if (!showRaw && !rawDoc && fraudCase?.cardTransactionInstanceReference) {
      // Real ciphertext from Atlas. L1 client cannot decrypt QE:none — that's the point.
      try {
        const doc = await api.system.rawDocument(
          'cardTransactionLog',
          fraudCase.cardTransactionInstanceReference,
          l2Token || '',
        );
        setRawDoc(doc);
      } catch { /* leave rawDoc null; the panel shows the unavailable state */ }
    }
    setShowRaw((v) => !v);
  }

  const stepIndex = STEPS.findIndex((s) => s.id === currentStep);
  const step = STEPS[stepIndex];
  const isEscalated = fraudCase?.caseStatus === 'escalated';
  const l2HasAccepted = !!fraudCase?.escalationAcceptedAt;
  const isResolved = !!fraudCase && ['resolved_cleared', 'resolved_fraud', 'closed'].includes(fraudCase.caseStatus);

  if (loading) return <div className="text-center py-12 text-gray-400">Loading case…</div>;
  if (!fraudCase) return <div className="text-center py-12 text-gray-500">Case not found.</div>;

  const snap = fraudCase.transactionSnapshot;

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/simulator/investigation" className="text-sm text-blue-600 hover:underline">Back to cases</Link>

      {/* Case header */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h1 className="text-xl font-bold">{fraudCase.fraudDiagnosisCaseReference}</h1>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEVERITY_COLORS[fraudCase.riskSeverity] ?? ''}`}>
            {fraudCase.riskSeverity.toUpperCase()}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[fraudCase.caseStatus] ?? ''}`}>
            {fraudCase.caseStatus.replace(/_/g, ' ')}
          </span>
        </div>
        {snap && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-700">
            <span className="font-medium text-gray-500">Amount:</span>
            <span className="font-semibold text-red-700">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: snap.cardTransactionAmount.currency }).format(snap.cardTransactionAmount.amount)}
            </span>
            <span className="font-medium text-gray-500">Merchant:</span>
            <span>{snap.cardTransactionMerchantName}</span>
            <span className="font-medium text-gray-500">Masked PAN:</span>
            <span className="font-mono">{snap.cardTransactionMaskedPanDisplay}</span>
            <span className="font-medium text-gray-500">Date:</span>
            <span>{new Date(snap.cardTransactionDateTime).toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Step navigator */}
      <div className="bg-[#001E2B] rounded-xl p-5 text-white">
        <p className="text-xs text-[#00ED64] font-semibold uppercase tracking-wider mb-3">Investigation Flow · live against the real API</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrentStep(s.id)}
              className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                s.id === currentStep
                  ? 'bg-[#00ED64] text-[#001E2B] border-[#00ED64]'
                  : i < stepIndex
                  ? 'bg-white/10 text-[#00ED64] border-[#00ED64]/40'
                  : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
              }`}
            >
              {i < stepIndex ? '✓ ' : ''}{s.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-start gap-3">
          <span className="text-2xl">{STEP_ICONS[step.icon]}</span>
          <div>
            <p className="font-semibold text-[#00ED64] text-sm">{step.role}</p>
            <p className="text-gray-300 text-sm mt-0.5">{step.description}</p>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg px-3 py-2 text-sm ${msg.startsWith('Error') ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-800'}`}>
          {msg}
        </div>
      )}

      {/* Step content */}
      {currentStep === 'l1-open' && (
        <L1OpenView fraudCase={fraudCase} showRaw={showRaw} rawDoc={rawDoc} onToggleRaw={toggleRaw} />
      )}
      {currentStep === 'l1-escalate' && (
        <L1EscalateView fraudCase={fraudCase} busy={busy} isEscalated={isEscalated} onEscalate={handleEscalate} />
      )}
      {currentStep === 'l2-review' && (
        <L2ReviewView
          fraudCase={fraudCase}
          customer={customer}
          escalationToken={escalationToken}
          l2HasAccepted={l2HasAccepted}
          isEscalated={isEscalated}
          busy={busy}
          onApprove={handleApprove}
          showRaw={showRaw}
          rawDoc={rawDoc}
          onToggleRaw={toggleRaw}
        />
      )}
      {currentStep === 'l2-resolve' && (
        <L2ResolveView fraudCase={fraudCase} busy={busy} isResolved={isResolved} canResolve={l2HasAccepted} onResolve={handleResolve} />
      )}
      {currentStep === 'customer-view' && <CustomerView fraudCase={fraudCase} />}

      {/* Nav buttons */}
      <div className="flex justify-between">
        <button onClick={() => stepIndex > 0 && setCurrentStep(STEPS[stepIndex - 1].id)} disabled={stepIndex === 0}
          className="px-4 py-2 rounded-lg border text-sm font-medium disabled:opacity-30 hover:bg-gray-50 transition-colors">
          Previous Step
        </button>
        <span className="text-xs text-gray-400 self-center">Step {stepIndex + 1} of {STEPS.length}</span>
        <button onClick={() => stepIndex < STEPS.length - 1 && setCurrentStep(STEPS[stepIndex + 1].id)} disabled={stepIndex === STEPS.length - 1}
          className="px-4 py-2 rounded-lg border border-[#001E2B] bg-[#001E2B] text-[#00ED64] text-sm font-medium disabled:opacity-30 hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors">
          Next Step
        </button>
      </div>
    </div>
  );
}

/* ── Step sub-views ──────────────────────────────────────────────────────── */

function RiskBlock({ fraudCase }: { fraudCase: FraudCase }) {
  const indicators = fraudCase.fraudDiagnosisAssessment?.riskIndicators ?? [];
  const score = fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-amber-600 font-semibold text-sm">Risk Assessment</span>
        {score !== undefined && <span className="ml-auto font-bold text-red-700">{score}/100</span>}
      </div>
      {indicators.length > 0 ? (
        <ul className="space-y-1">
          {indicators.map((ind) => (
            <li key={ind} className="flex items-start gap-2 text-sm text-amber-800"><span className="text-amber-500 mt-0.5">!</span>{formatRiskIndicator(ind)}</li>
          ))}
        </ul>
      ) : <p className="text-sm text-amber-700">No risk indicators recorded.</p>}
    </div>
  );
}

function L1OpenView({ fraudCase, showRaw, rawDoc, onToggleRaw }: {
  fraudCase: FraudCase; showRaw: boolean; rawDoc: RawDocumentResponse | null; onToggleRaw: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">👤</span>
          <div><p className="font-semibold text-gray-900">Level 1 Analyst</p><p className="text-xs text-gray-500">Opens the case at L1 access level</p></div>
          <span className="ml-auto bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">L1 Access</span>
        </div>
        <p className="text-sm text-gray-600">An automated rule flagged this transaction. The analyst reviews the data visible at L1 level: transaction metadata and QE:equality fields. Sensitive PII (address, government ID) stays locked behind the L2 DEK.</p>
        <RiskBlock fraudCase={fraudCase} />
        <div className="rounded-lg border divide-y text-sm">
          <div className="px-3 py-2 bg-blue-50">
            <p className="text-xs font-semibold text-blue-700 uppercase mb-1.5">L1 can search (QE:equality, encrypted but queryable)</p>
            <div className="flex flex-wrap gap-2">
              <EncryptionBadge label="Email" type="qe-equality" />
              <EncryptionBadge label="Phone" type="qe-equality" />
              <EncryptionBadge label="Account Reference" type="qe-equality" />
            </div>
          </div>
          <div className="px-3 py-2 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">L2 only (QE:none, separate DEK)</p>
            <div className="flex flex-wrap gap-2">
              <EncryptionBadge label="Physical Address" type="qe-none" />
              <EncryptionBadge label="Government ID" type="qe-none" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <div><h2 className="font-semibold text-gray-800">What Atlas Stores</h2><p className="text-xs text-gray-500 mt-0.5">Live ciphertext from MongoDB Atlas</p></div>
          <button onClick={onToggleRaw} className="text-sm font-medium px-3 py-1.5 rounded-lg border hover:bg-gray-50 transition-colors">
            {showRaw ? 'Hide Raw Document' : 'View cardTransactionLog Raw'}
          </button>
        </div>
        {showRaw && (rawDoc ? (
          <RawDocumentPanel document={rawDoc.document} collection={rawDoc.collection} />
        ) : (
          <p className="text-sm text-gray-500 italic">Raw document unavailable at L1 access. Approve the L2 escalation (step 3) to fetch the live document with elevated access.</p>
        ))}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>MongoDB QE in action:</strong> the analyst searches by email, phone, or account reference using Queryable Encryption. Atlas matches ciphertext-to-ciphertext; plaintext never reaches the server.
      </div>
    </div>
  );
}

function L1EscalateView({ fraudCase, busy, isEscalated, onEscalate }: {
  fraudCase: FraudCase; busy: boolean; isEscalated: boolean; onEscalate: () => void;
}) {
  const score = fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore;
  const alreadyMoved = isEscalated || !!fraudCase.escalationAcceptedAt || ['resolved_cleared', 'resolved_fraud', 'closed'].includes(fraudCase.caseStatus);
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <p className="text-sm text-gray-600">Risk exceeds L1 authority. The analyst escalates to Level 2 investigation. This calls <code className="text-xs">POST /api/v1/fraud/:id/escalate</code> with a real L1 token.</p>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="font-semibold text-red-800 text-sm mb-2">Escalation Criteria</p>
          <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
            {score !== undefined && <li>Risk score {score}/100 exceeds the L1 threshold</li>}
            <li>PII fields locked behind L2 QE access control</li>
          </ul>
        </div>
        <button
          onClick={onEscalate}
          disabled={busy || alreadyMoved}
          className="w-full bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors disabled:opacity-40"
        >
          {alreadyMoved ? `Already ${fraudCase.caseStatus.replace(/_/g, ' ')}` : busy ? 'Escalating…' : 'Escalate to Level 2 (as L1)'}
        </button>
      </div>
      <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm">
        <strong>PCI DSS alignment:</strong> the escalation boundary is enforced at the encryption-key level. The L1 token cannot decrypt QE:none fields; only an approved L2 investigator can.
      </div>
    </div>
  );
}

function L2ReviewView({ fraudCase, customer, escalationToken, l2HasAccepted, isEscalated, busy, onApprove, showRaw, rawDoc, onToggleRaw }: {
  fraudCase: FraudCase; customer: Record<string, unknown> | null; escalationToken: string | null;
  l2HasAccepted: boolean; isEscalated: boolean; busy: boolean; onApprove: () => void;
  showRaw: boolean; rawDoc: RawDocumentResponse | null; onToggleRaw: () => void;
}) {
  const addr = customer?.customerAgreementResidentialAddress as Addr | undefined;
  const govId = customer?.governmentIdentificationReference as string | undefined;
  const email = customer?.customerEmailAddress as string | undefined;
  const phone = customer?.customerMobilePhoneNumber as string | undefined;
  const accountRef = customer?.customerAgreementReference as string | undefined;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔍</span>
          <div><p className="font-semibold text-gray-900">Level 2 Investigator</p><p className="text-xs text-gray-500">Approves the escalation, gaining DEK-sensitive access</p></div>
          <span className="ml-auto bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded">L2 Access</span>
        </div>

        {!l2HasAccepted ? (
          <>
            <p className="text-sm text-gray-600">Approving calls <code className="text-xs">POST /api/v1/fraud/:id/escalate/approve</code> with a real L2 token. The backend issues an escalation token (4 h TTL) that unlocks QE:none fields.</p>
            <button
              onClick={onApprove}
              disabled={busy || !isEscalated}
              className="w-full bg-purple-700 text-white py-2.5 rounded-lg font-semibold hover:bg-purple-800 transition-colors disabled:opacity-40"
            >
              {!isEscalated ? 'Case must be escalated first' : busy ? 'Approving…' : 'Approve escalation (as L2)'}
            </button>
          </>
        ) : (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-800">
            <p className="font-semibold mb-1">Escalation approved</p>
            {escalationToken
              ? <p className="font-mono text-purple-600 break-all">X-Escalation-Token: {escalationToken.slice(0, 16)}…</p>
              : <p>Accepted at {fraudCase.escalationAcceptedAt && new Date(fraudCase.escalationAcceptedAt).toLocaleString()}.</p>}
            <p className="mt-1">Every access to QE:none fields is logged as a <code>field_accessed</code> audit event.</p>
          </div>
        )}

        <h3 className="font-semibold text-sm text-gray-700">Customer Profile (live record)</h3>
        <div className="rounded-lg border divide-y text-sm">
          <div className="px-3 py-2 bg-blue-50 space-y-2">
            <p className="text-xs font-semibold text-blue-700 uppercase">QE:equality (L1 + L2)</p>
            <Field label="Email" value={email} type="qe-equality" />
            <Field label="Phone" value={phone} type="qe-equality" />
            <Field label="Account Reference" value={accountRef} type="qe-equality" />
          </div>
          <div className="px-3 py-2 bg-purple-50 space-y-2">
            <p className="text-xs font-semibold text-purple-700 uppercase">QE:none (L2 only, after approval)</p>
            <Field
              label="Physical Address"
              value={addr ? [addr.streetAddress, addr.city, addr.postalCode, addr.countryCode].filter(Boolean).join(', ') : undefined}
              type="qe-none"
              locked={!l2HasAccepted}
            />
            <Field label="Government ID" value={govId} type="qe-none" locked={!l2HasAccepted} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <div><h2 className="font-semibold text-gray-800">Atlas Storage: Raw Document</h2><p className="text-xs text-gray-500 mt-0.5">cardTransactionLog · live ciphertext</p></div>
          <button onClick={onToggleRaw} className="text-sm font-medium px-3 py-1.5 rounded-lg border hover:bg-gray-50 transition-colors">
            {showRaw ? 'Business View' : 'View Raw Atlas Document'}
          </button>
        </div>
        {showRaw && (rawDoc
          ? <RawDocumentPanel document={rawDoc.document} collection={rawDoc.collection} />
          : <p className="text-sm text-gray-500 italic">Approve the escalation to fetch the live document.</p>)}
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-sm text-purple-900">
        <strong>Key insight:</strong> Atlas never sees plaintext PII. QE decrypts client-side with DEKs from the key vault. L2 access covers the additional QE:none DEK only after escalation approval.
      </div>
    </div>
  );
}

function Field({ label, value, type, locked }: { label: string; value?: string; type: 'qe-equality' | 'qe-none'; locked?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <EncryptionBadge label={label} type={type} />
      {locked
        ? <span className="text-gray-400 text-xs italic">🔒 locked, requires L2 escalation</span>
        : <span className="text-green-700 font-mono text-xs">{value ?? '—'}</span>}
    </div>
  );
}

function L2ResolveView({ fraudCase, busy, isResolved, canResolve, onResolve }: {
  fraudCase: FraudCase; busy: boolean; isResolved: boolean; canResolve: boolean; onResolve: (o: 'confirmed_fraud' | 'cleared') => void;
}) {
  const resolution = fraudCase.fraudDiagnosisResolutionRecord;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <p className="text-sm text-gray-600">The investigator documents findings and resolves the case via <code className="text-xs">PATCH /api/v1/fraud/:id</code> with a real L2 token. The outcome persists and appears in the audit log.</p>
        {isResolved ? (
          <div className="bg-gray-50 border rounded-lg p-4 text-sm">
            <p className="font-medium text-gray-700 mb-1">Resolution Record</p>
            <p>Outcome: <span className="font-semibold">{resolution?.resolutionOutcome ?? fraudCase.caseStatus}</span></p>
            {resolution?.resolutionNotes && <p className="text-gray-500 mt-1">{resolution.resolutionNotes}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={() => onResolve('confirmed_fraud')} disabled={busy || !canResolve}
              className="bg-red-600 text-white py-2.5 rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-40">
              {busy ? 'Resolving…' : 'Resolve as Confirmed Fraud'}
            </button>
            <button onClick={() => onResolve('cleared')} disabled={busy || !canResolve}
              className="bg-green-600 text-white py-2.5 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-40">
              {busy ? 'Resolving…' : 'Resolve as Cleared'}
            </button>
            {!canResolve && <p className="sm:col-span-2 text-xs text-amber-600">Approve the L2 escalation (step 3) before resolving.</p>}
          </div>
        )}
      </div>
      <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm">
        <strong>PCI DSS v4.0:</strong> the complete investigation trail satisfies Req 10 (audit logging), Req 3 (CHD protection via QE), and Req 7 (role-based access).
      </div>
    </div>
  );
}

function CustomerView({ fraudCase }: { fraudCase: FraudCase }) {
  const snap = fraudCase.transactionSnapshot;
  const amount = snap
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: snap.cardTransactionAmount.currency }).format(snap.cardTransactionAmount.amount)
    : 'N/A';
  const outcome = fraudCase.fraudDiagnosisResolutionRecord?.resolutionOutcome;
  const isFraud = fraudCase.caseStatus === 'resolved_fraud' || outcome === 'confirmed_fraud';
  const resolved = ['resolved_cleared', 'resolved_fraud', 'closed'].includes(fraudCase.caseStatus);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🧑</span>
          <div><p className="font-semibold text-gray-900">Customer Outcome</p><p className="text-xs text-gray-500">What the customer sees after the investigation</p></div>
          <span className="ml-auto bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded">Customer View</span>
        </div>

        {!resolved ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            The case is still <strong>{fraudCase.caseStatus.replace(/_/g, ' ')}</strong>. Resolve it (step 4) to see the customer outcome.
          </div>
        ) : (
          <div className={`rounded-lg p-4 border ${isFraud ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
            <p className={`font-semibold mb-1 ${isFraud ? 'text-green-800' : 'text-blue-800'}`}>
              {isFraud ? 'Your dispute has been resolved' : 'Transaction reviewed and cleared'}
            </p>
            <p className={`text-sm ${isFraud ? 'text-green-700' : 'text-blue-700'}`}>
              The transaction of <strong>{amount}</strong> at <strong>{snap?.cardTransactionMerchantName ?? 'the merchant'}</strong>{' '}
              {isFraud
                ? 'was confirmed as fraud. A full refund has been issued and a new card will be dispatched.'
                : 'was reviewed and confirmed legitimate. No action needed on your account.'}
            </p>
          </div>
        )}

        <div className="border rounded-lg p-4 bg-gray-50 text-sm">
          <p className="font-medium text-gray-700 mb-1">Case summary</p>
          <div className="grid grid-cols-2 gap-1 text-gray-600">
            <span>Case number:</span><span className="font-mono text-xs">{fraudCase.fraudDiagnosisCaseReference}</span>
            <span>Status:</span><span className="capitalize">{fraudCase.caseStatus.replace(/_/g, ' ')}</span>
          </div>
        </div>
      </div>

      <div className="bg-[#001E2B] text-white rounded-xl p-5 text-sm">
        <p className="text-[#00ED64] font-semibold mb-2">MongoDB QE: end-to-end data security</p>
        <ul className="space-y-1 text-gray-300 list-disc list-inside">
          <li>Queryable Encryption lets analysts search encrypted fields without decryption</li>
          <li>Role-based DEK access enforces least-privilege at the cryptographic layer</li>
          <li>PCI DSS Requirements 3, 7, and 10 satisfied with minimal overhead</li>
        </ul>
      </div>
    </div>
  );
}
