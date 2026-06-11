'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, RawDocumentResponse } from '../../../../lib/api';
import { EncryptionBadge } from '../../../../components/EncryptionBadge';
import { RawDocumentPanel } from '../../../../components/RawDocumentPanel';
import { SEVERITY_COLORS, STATUS_COLORS, formatRiskIndicator } from '../../../../lib/constants';

type StepId = 'l1-open' | 'l1-escalate' | 'l2-review' | 'l2-resolve' | 'customer-view';

interface Step {
  id: StepId;
  label: string;
  role: string;
  icon: string;
  description: string;
}

const STEPS: Step[] = [
  {
    id: 'l1-open',
    label: 'L1 Opens Ticket',
    role: 'Level 1 Analyst',
    icon: 'person',
    description: 'L1 support agent Sarah Chen reviews the flagged transaction and opens the fraud investigation ticket.',
  },
  {
    id: 'l1-escalate',
    label: 'L1 Escalates to L2',
    role: 'Level 1 Analyst',
    icon: 'escalate',
    description: 'Risk indicators exceed L1 authority. Sarah escalates the case to Level 2 fraud investigation.',
  },
  {
    id: 'l2-review',
    label: 'L2 Deep Analysis',
    role: 'Level 2 Investigator',
    icon: 'search',
    description: 'Investigator Michael Obi receives the escalation and conducts a full forensic review with elevated data access.',
  },
  {
    id: 'l2-resolve',
    label: 'L2 Resolution',
    role: 'Level 2 Investigator',
    icon: 'check',
    description: 'Michael documents findings, confirms fraud, and triggers the resolution workflow.',
  },
  {
    id: 'customer-view',
    label: 'Customer Notification',
    role: 'Customer (Luis)',
    icon: 'person',
    description: 'Luis Fernandez receives the outcome: transaction disputed, card replaced, data protected.',
  },
];

const STEP_ICONS: Record<string, string> = {
  person: '👤',
  escalate: '⬆️',
  search: '🔍',
  check: '✅',
};

// v2 demo document: sensitive fields are inline (no *Sensitive collection).
// QE:equality field (cardTransactionAccountReference) and QE:none fields
// (rawGatewayPayload, processorTransactionMetadata) both appear as BSON Binary
// when read by the Level 1 client - Atlas never stores plaintext.
const DEMO_RAW_TRANSACTION: Record<string, unknown> = {
  _id: { $oid: '6650a2b3c4d5e6f700000001' },
  cardTransactionInstanceReference: 'a7f3d891-2c45-4b67-8e12-9f0a1b2c3d4e',
  paymentCardReference: 'tok_sim_7xB2kp1q',
  cardTransactionAccountReference: {
    $binary: { base64: 'BhKJ9KMsQfY7lP+2Xa8nDEz1rVwCqI5uH0TbGmOjS6Ry==', subType: '06' },
  },
  rawGatewayPayload: {
    $binary: { base64: 'Cv3xZ1pQmNkLtA8rEoWsYfUiBhGjDnK2McTvPqHaXeOl==', subType: '06' },
  },
  processorTransactionMetadata: {
    $binary: { base64: 'Dw4yA2bRnCsJuF9oZkVpGxHiLeTmQdIwNjMrBtPaKlXe==', subType: '06' },
  },
  cardTransactionAmount: { amount: 850, currency: 'USD' },
  cardTransactionDateTime: '2026-06-04T14:32:17.000Z',
  cardTransactionStatus: 'authorized',
  cardTransactionMaskedPanDisplay: '****-****-****-4291',
  cardTransactionMerchantName: 'Casino Royale',
  cardTransactionMerchantCategoryCode: '7995',
  schemaVersion: 2,
  recordCreatedDateTime: '2026-06-04T14:32:17.000Z',
};

export default function SimulatorCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [rawDoc, setRawDoc] = useState<RawDocumentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<StepId>('l1-open');

  useEffect(() => {
    api.fraud.getById(caseId, '')
      .then(setFraudCase)
      .catch(() => setFraudCase(null))
      .finally(() => setLoading(false));
  }, [caseId]);

  async function toggleRaw() {
    if (!showRaw && !rawDoc && fraudCase) {
      // Simulator has no JWT; try the real endpoint first, fall back to demo document
      try {
        const doc = await api.system.rawDocument(
          'cardTransactionLog',
          fraudCase.cardTransactionInstanceReference,
          ''
        );
        setRawDoc(doc);
      } catch {
        // Expected in simulator (no JWT). Use static demo ciphertext.
        setRawDoc({ collection: 'cardTransactionLog', document: DEMO_RAW_TRANSACTION });
      }
    }
    setShowRaw((v) => !v);
  }

  const stepIndex = STEPS.findIndex((s) => s.id === currentStep);
  const step = STEPS[stepIndex];

  function goNext() {
    if (stepIndex < STEPS.length - 1) setCurrentStep(STEPS[stepIndex + 1].id);
  }
  function goPrev() {
    if (stepIndex > 0) setCurrentStep(STEPS[stepIndex - 1].id);
  }

  if (loading) return <div className="text-center py-12 text-gray-400">Loading case...</div>;
  if (!fraudCase) return <div className="text-center py-12 text-gray-500">Case not found.</div>;

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/simulator/investigation" className="text-sm text-blue-600 hover:underline">
        Back to cases
      </Link>

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
        {fraudCase.transactionSnapshot && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-700">
            <span className="font-medium text-gray-500">Amount:</span>
            <span className="font-semibold text-red-700">
              {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: fraudCase.transactionSnapshot.cardTransactionAmount.currency,
              }).format(fraudCase.transactionSnapshot.cardTransactionAmount.amount)}
            </span>
            <span className="font-medium text-gray-500">Merchant:</span>
            <span>{fraudCase.transactionSnapshot.cardTransactionMerchantName}</span>
            <span className="font-medium text-gray-500">Masked PAN:</span>
            <span className="font-mono">{fraudCase.transactionSnapshot.cardTransactionMaskedPanDisplay}</span>
            <span className="font-medium text-gray-500">Date:</span>
            <span>{new Date(fraudCase.transactionSnapshot.cardTransactionDateTime).toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Step navigator */}
      <div className="bg-[#001E2B] rounded-xl p-5 text-white">
        <p className="text-xs text-[#00ED64] font-semibold uppercase tracking-wider mb-3">Investigation Flow</p>
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

      {/* Step content */}
      {currentStep === 'l1-open' && (
        <L1OpenView
          fraudCase={fraudCase}
          showRaw={showRaw}
          rawDoc={rawDoc}
          onToggleRaw={toggleRaw}
        />
      )}
      {currentStep === 'l1-escalate' && (
        <L1EscalateView fraudCase={fraudCase} />
      )}
      {currentStep === 'l2-review' && (
        <L2ReviewView
          fraudCase={fraudCase}
          showRaw={showRaw}
          rawDoc={rawDoc}
          onToggleRaw={toggleRaw}
        />
      )}
      {currentStep === 'l2-resolve' && (
        <L2ResolveView fraudCase={fraudCase} />
      )}
      {currentStep === 'customer-view' && (
        <CustomerView fraudCase={fraudCase} />
      )}

      {/* Nav buttons */}
      <div className="flex justify-between">
        <button
          onClick={goPrev}
          disabled={stepIndex === 0}
          className="px-4 py-2 rounded-lg border text-sm font-medium disabled:opacity-30 hover:bg-gray-50 transition-colors"
        >
          Previous Step
        </button>
        <span className="text-xs text-gray-400 self-center">
          Step {stepIndex + 1} of {STEPS.length}
        </span>
        <button
          onClick={goNext}
          disabled={stepIndex === STEPS.length - 1}
          className="px-4 py-2 rounded-lg border border-[#001E2B] bg-[#001E2B] text-[#00ED64] text-sm font-medium disabled:opacity-30 hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
        >
          Next Step
        </button>
      </div>

      {/* Action log */}
      {fraudCase.diagnosisActionLog && fraudCase.diagnosisActionLog.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold mb-3 text-gray-800">Action Log</h2>
          <div className="space-y-2">
            {fraudCase.diagnosisActionLog.map((event, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="text-gray-400 font-mono text-xs whitespace-nowrap">
                  {new Date(event.actionDateTime).toLocaleTimeString()}
                </span>
                <span className="font-medium">{event.actionType.replace(/_/g, ' ')}</span>
                <span className="text-gray-500">{event.performedByRole}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Step sub-views ---- */

function L1OpenView({
  fraudCase,
  showRaw,
  rawDoc,
  onToggleRaw,
}: {
  fraudCase: FraudCase;
  showRaw: boolean;
  rawDoc: RawDocumentResponse | null;
  onToggleRaw: () => void;
}) {
  const snap = fraudCase.transactionSnapshot;
  const indicators = fraudCase.fraudDiagnosisAssessment?.riskIndicators ?? [];
  const score = fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore;

  return (
    <div className="space-y-4">
      {/* Analyst card */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">👤</span>
          <div>
            <p className="font-semibold text-gray-900">Sarah Chen</p>
            <p className="text-xs text-gray-500">Level 1 Support Analyst</p>
          </div>
          <span className="ml-auto bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">L1 Access</span>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          An automated rule triggered a fraud alert on this transaction. Sarah opens the case and reviews
          the available data at L1 access level.
        </p>

        {/* Transaction details */}
        {snap && (
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <h3 className="font-semibold text-sm text-gray-700 mb-2">Transaction Details</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-gray-500">Amount:</span>
              <span className="font-semibold text-red-700">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: snap.cardTransactionAmount.currency,
                }).format(snap.cardTransactionAmount.amount)}
              </span>
              <span className="text-gray-500">Merchant:</span>
              <span className="font-medium">{snap.cardTransactionMerchantName}</span>
              <span className="text-gray-500">Card (masked):</span>
              <span className="font-mono">{snap.cardTransactionMaskedPanDisplay}</span>
              <span className="text-gray-500">Date / Time:</span>
              <span>{new Date(snap.cardTransactionDateTime).toLocaleString()}</span>
              <span className="text-gray-500">Txn Status:</span>
              <span className="capitalize">{snap.cardTransactionStatus}</span>
            </div>
          </div>
        )}

        {/* Risk assessment */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-amber-600 font-semibold text-sm">Risk Assessment</span>
            {score !== undefined && (
              <span className="ml-auto font-bold text-red-700">{score}/100</span>
            )}
          </div>
          {indicators.length > 0 ? (
            <ul className="space-y-1">
              {indicators.map((ind) => (
                <li key={ind} className="flex items-start gap-2 text-sm text-amber-800">
                  <span className="text-amber-500 mt-0.5">!</span>
                  {formatRiskIndicator(ind)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-700">No risk indicators recorded.</p>
          )}
        </div>

        {/* L1 triage decision context */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <p className="font-semibold text-amber-800 text-sm mb-1">L1 Triage Assessment</p>
          <p className="text-xs text-amber-700 mb-2">
            Sarah reviews the case against L1 authority thresholds. Based on the FDS operating model,
            L1 can close, add notes, or escalate. Actions that require PII are reserved for L2.
          </p>
          <div className="grid grid-cols-2 gap-1 text-xs text-amber-800">
            <span className="font-medium">L1 can:</span>
            <span>Review transaction, risk score, indicators</span>
            <span className="font-medium">L1 can search:</span>
            <span>By email, phone, or account reference (QE:equality)</span>
            <span className="font-medium">L1 cannot see:</span>
            <span>Physical address, Government ID (QE:none, L2 only)</span>
            <span className="font-medium">L1 action:</span>
            <span className="font-semibold text-red-700">Escalate - risk score exceeds L1 threshold</span>
          </div>
        </div>

        {/* Data visibility: L1 vs L2 */}
        <h3 className="font-semibold text-sm text-gray-700 mb-2">Customer Data Access by Role</h3>
        <div className="rounded-lg border divide-y text-sm">
          <div className="px-3 py-2 bg-blue-50">
            <p className="text-xs font-semibold text-blue-700 uppercase mb-1.5">
              L1 can search these fields (QE:equality - encrypted but queryable)
            </p>
            <p className="text-xs text-blue-600 mb-2">
              QE:equality fields are searchable without decryption. The MongoDB driver sends
              a deterministic ciphertext of the search value. Atlas compares ciphertext-to-ciphertext.
              No plaintext leaves the application.
            </p>
            <div className="space-y-1.5">
              {[
                { label: 'Email', note: 'Primary search key - L1 enters a known email to retrieve the customer' },
                { label: 'Phone', note: 'Secondary search key - used when email is unknown' },
                { label: 'Account Reference', note: 'Account number equivalent - linked to this fraud case' },
              ].map(({ label, note }) => (
                <div key={label} className="flex items-start gap-2">
                  <EncryptionBadge label={label} type="qe-equality" />
                  <span className="text-blue-700 text-xs">{note}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="px-3 py-2 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
              L2 only - QE:none (encrypted, not searchable, separate DEK)
            </p>
            <p className="text-xs text-gray-500 mb-2">
              These fields use a separate Data Encryption Key (DEK-sensitive). The L1 client
              does not receive this DEK. Decryption only happens after the L2 investigator
              approves the escalation.
            </p>
            <div className="space-y-1.5">
              {[
                { label: 'Physical Address', note: 'Full residential address - required for identity verification and fraud recovery' },
                { label: 'Government ID', note: 'National ID or passport reference - used for high-confidence identity confirmation' },
              ].map(({ label, note }) => (
                <div key={label} className="flex items-start gap-2">
                  <EncryptionBadge label={label} type="qe-none" />
                  <span className="text-gray-400 text-xs">{note}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Atlas storage: what L1 sees vs what Atlas actually holds */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-gray-800">What Atlas Stores</h2>
            <p className="text-xs text-gray-500 mt-0.5">Two collections involved in this fraud case</p>
          </div>
          <button
            onClick={onToggleRaw}
            className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg border hover:bg-gray-50 transition-colors"
          >
            {showRaw ? 'Hide Raw Document' : 'View cardTransactionLog Raw'}
          </button>
        </div>

        {/* Collection map */}
        <div className="space-y-3 mb-4">
          <div className="rounded-lg border p-3 bg-blue-50">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-blue-700 uppercase">cardTransactionLog (SD-254)</span>
              <span className="text-xs bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded">L1 can access</span>
            </div>
            <p className="text-xs text-blue-700 mb-2">
              The payment event record. Amount, merchant, channel, and masked PAN are plaintext.
              The account reference linking the card to the customer is QE:equality encrypted.
            </p>
            {snap && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                <span className="text-gray-500">Amount:</span>
                <span className="text-green-700 font-medium">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: snap.cardTransactionAmount.currency }).format(snap.cardTransactionAmount.amount)}
                  <span className="text-gray-400 ml-1">(plaintext)</span>
                </span>
                <span className="text-gray-500">Merchant:</span>
                <span className="text-green-700">{snap.cardTransactionMerchantName} <span className="text-gray-400">(plaintext)</span></span>
                <span className="text-gray-500">Masked PAN:</span>
                <span className="text-green-700 font-mono">{snap.cardTransactionMaskedPanDisplay} <span className="text-gray-400">(plaintext)</span></span>
                <span className="text-gray-500">Account Ref:</span>
                <span className="text-orange-700 font-mono text-xs">
                  BhKJ9... <span className="text-gray-400">(QE:equality ciphertext)</span>
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-3 bg-gray-50">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-gray-600 uppercase">fraudDiagnosisCase (SD-83)</span>
              <span className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">L1 can access</span>
            </div>
            <p className="text-xs text-gray-600 mb-2">
              The investigation case created when the transaction triggered a fraud rule.
              No QE encryption: case metadata contains no PII. References point to protected records.
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              <span className="text-gray-500">Case Ref:</span>
              <span className="text-green-700">{fraudCase.fraudDiagnosisCaseReference}</span>
              <span className="text-gray-500">Status:</span>
              <span className="capitalize">{fraudCase.caseStatus}</span>
              <span className="text-gray-500">Severity:</span>
              <span className="capitalize">{fraudCase.riskSeverity}</span>
              <span className="text-gray-500">Customer FK:</span>
              <span className="text-gray-500 font-mono text-xs">{fraudCase.customerAgreementInstanceReference?.slice(0, 12)}... (UUID)</span>
            </div>
          </div>

          <div className="rounded-lg border p-3 bg-purple-50 opacity-75">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-purple-700 uppercase">customerAgreementProcedure (SD-53) - QE:none fields</span>
              <span className="text-xs bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded">L2 only</span>
            </div>
            <p className="text-xs text-purple-700">
              Residential address (<code>customerAgreementResidentialAddress</code>) and government ID
              (<code>governmentIdentificationReference</code>) are stored <strong>inline</strong> in the
              same <code>customerAgreementProcedure</code> document - there is no separate sensitive collection.
              These QE:none fields use <code>DEK-sensitive</code> (a different key from <code>DEK-lookup</code>).
              The L1 client never receives <code>DEK-sensitive</code>, so these fields arrive as BSON Binary
              ciphertext and are stripped by the service layer before the response is returned.
            </p>
          </div>
        </div>

        {showRaw && rawDoc && (
          <>
            <div className="text-xs font-semibold text-gray-600 mb-2">Raw cardTransactionLog document from Atlas:</div>
            <RawDocumentPanel document={rawDoc.document} collection={rawDoc.collection} />
          </>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>MongoDB QE in action:</strong> Sarah can search by email, phone, or account reference
        using Queryable Encryption. Atlas receives and matches ciphertext-to-ciphertext.
        Plaintext never reaches the server. Sensitive fields (QE:none) are stored inline in
        the same document but returned as Binary ciphertext to the L1 client - the DEK-sensitive
        key never leaves the L2 application context.
      </div>
    </div>
  );
}

function L1EscalateView({ fraudCase }: { fraudCase: FraudCase }) {
  const score = fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore;
  const indicators = fraudCase.fraudDiagnosisAssessment?.riskIndicators ?? [];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">👤</span>
          <div>
            <p className="font-semibold text-gray-900">Sarah Chen</p>
            <p className="text-xs text-gray-500">Level 1 Support Analyst</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Based on the risk score and indicators, L1 authority is insufficient. Sarah triggers escalation
          to Level 2 fraud investigation.
        </p>

        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="font-semibold text-red-800 text-sm mb-2">Escalation Criteria Met</p>
          <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
            {score !== undefined && (
              <li>Risk score {score}/100 exceeds L1 threshold (70)</li>
            )}
            {indicators.map((ind) => (
              <li key={ind}>{formatRiskIndicator(ind)}</li>
            ))}
            <li>PII fields locked behind L2 QE access control</li>
          </ul>
        </div>

        <div className="border rounded-lg p-4 bg-gray-50 text-sm space-y-2">
          <p className="font-medium text-gray-700">Escalation Record</p>
          <div className="grid grid-cols-2 gap-1 text-gray-600">
            <span>Escalated by:</span><span className="font-medium">Sarah Chen (L1)</span>
            <span>Escalated to:</span><span className="font-medium">L2 Fraud Investigation Queue</span>
            <span>Case status:</span>
            <span>
              <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs font-medium">escalated</span>
            </span>
            <span>Priority:</span>
            <span className="font-semibold text-red-600">{fraudCase.riskSeverity.toUpperCase()}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-sm text-gray-700 mb-3">What changes when escalated?</h3>
        <div className="space-y-3 text-sm">
          <div className="flex gap-3">
            <span className="text-green-500 font-bold mt-0.5">+</span>
            <div>
              <p className="font-medium">L2 investigators gain access to QE:none fields</p>
              <p className="text-gray-500">Physical address and government ID become readable via the QE-enabled client under the L2 DEK</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="text-green-500 font-bold mt-0.5">+</span>
            <div>
              <p className="font-medium">Full transaction forensics available</p>
              <p className="text-gray-500">Cross-account correlation, device fingerprint, and geo data</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="text-blue-500 font-bold mt-0.5">i</span>
            <div>
              <p className="font-medium">Audit trail updated</p>
              <p className="text-gray-500">Every role transition is immutably logged in MongoDB with timestamps</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm">
        <strong>PCI DSS alignment:</strong> Role-based data access ensures that only authorized personnel
        at the appropriate trust level can view sensitive cardholder data. The escalation boundary is
        enforced at the encryption key level, not just application logic.
      </div>
    </div>
  );
}

function L2ReviewView({
  fraudCase,
  showRaw,
  rawDoc,
  onToggleRaw,
}: {
  fraudCase: FraudCase;
  showRaw: boolean;
  rawDoc: RawDocumentResponse | null;
  onToggleRaw: () => void;
}) {
  const snap = fraudCase.transactionSnapshot;
  const indicators = fraudCase.fraudDiagnosisAssessment?.riskIndicators ?? [];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🔍</span>
          <div>
            <p className="font-semibold text-gray-900">Michael Obi</p>
            <p className="text-xs text-gray-500">Level 2 Fraud Investigator</p>
          </div>
          <span className="ml-auto bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded">L2 Access</span>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Michael receives the escalation from Sarah and approves it. The escalation token grants
          the L2 QE client access to DEK-sensitive, unlocking QE:none fields. Full forensic data
          is now available from multiple collections.
        </p>

        {/* Escalation token context */}
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4 text-xs text-purple-800">
          <p className="font-semibold mb-1">Escalation token issued (FR-v2-11)</p>
          <p className="font-mono text-purple-600 mb-1">X-Escalation-Token: 4e7a9f2b-...</p>
          <p>Token TTL: 4 hours. The RBAC middleware validates this token on every request to
          sensitive endpoints. Any access to QE:none fields is logged as a <code>field_accessed</code> audit event.</p>
        </div>

        {/* Transaction summary at L2 */}
        {snap && (
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <h3 className="font-semibold text-sm text-gray-700 mb-2">Transaction Details</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-gray-500">Amount:</span>
              <span className="font-semibold text-red-700">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: snap.cardTransactionAmount.currency,
                }).format(snap.cardTransactionAmount.amount)}
              </span>
              <span className="text-gray-500">Merchant:</span>
              <span>{snap.cardTransactionMerchantName}</span>
              <span className="text-gray-500">Card (masked):</span>
              <span className="font-mono">{snap.cardTransactionMaskedPanDisplay}</span>
              <span className="text-gray-500">Date / Time:</span>
              <span>{new Date(snap.cardTransactionDateTime).toLocaleString()}</span>
              <span className="text-gray-500">Channel:</span>
              <span className="capitalize">{snap.cardTransactionStatus}</span>
            </div>
          </div>
        )}

        {/* Risk indicators context */}
        {indicators.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="font-semibold text-red-800 text-xs mb-1">Active fraud indicators</p>
            <ul className="text-xs text-red-700 space-y-0.5">
              {indicators.map((ind) => (
                <li key={ind} className="flex gap-1.5">
                  <span className="text-red-400 mt-0.5">!</span>
                  {formatRiskIndicator(ind)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <h3 className="font-semibold text-sm text-gray-700 mb-2">Customer Profile: Extended L2 View</h3>
        <div className="rounded-lg border divide-y text-sm mb-4">
          <div className="px-3 py-2 bg-blue-50">
            <p className="text-xs font-semibold text-blue-700 uppercase mb-1.5">QE:equality fields (available to L1 and L2)</p>
            <div className="space-y-2">
              {[
                { label: 'Email', value: 'luis.fernandez@back.es' },
                { label: 'Phone', value: '+44 7700 900123' },
                { label: 'Account Reference', value: 'luis.fernandez@back.es' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-2">
                  <EncryptionBadge label={label} type="qe-equality" />
                  <span className="text-green-700 font-mono text-xs">{value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="px-3 py-2 bg-purple-50">
            <p className="text-xs font-semibold text-purple-700 uppercase mb-1.5">
              QE:none fields (L2 only - decrypted after escalation approval)
            </p>
            <p className="text-xs text-purple-600 mb-1.5">
              Decrypted client-side using DEK-sensitive. The plaintext is never sent to Atlas.
            </p>
            <div className="space-y-2">
              {[
                { label: 'Physical Address', value: '742 Evergreen Terrace, Springfield, IL 62704' },
                { label: 'Government ID', value: 'XXX-XX-4821 (masked per PCI DSS)' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-2">
                  <EncryptionBadge label={label} type="qe-none" />
                  <span className="text-green-700 font-mono text-xs">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* L2 additional investigation sources */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2">
          <p className="font-semibold text-sm text-gray-700 mb-2">Additional investigation sources available to L2</p>
          <div className="space-y-2 text-xs text-gray-600">
            <div className="flex gap-2">
              <span className="text-purple-500 font-bold mt-0.5">+</span>
              <div>
                <p className="font-medium">cardTransactionLog (SD-254) - QE:none fields</p>
                <p className="text-gray-500">
                  <code>rawGatewayPayload</code> and <code>processorTransactionMetadata</code> are stored
                  inline in the same <code>cardTransactionLog</code> document as QE:none fields.
                  No separate sensitive collection exists. The L2 client decrypts them using <code>DEK-sensitive</code>
                  after escalation approval. Contains authorization codes and network identifiers.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="text-purple-500 font-bold mt-0.5">+</span>
              <div>
                <p className="font-medium">Transaction history by card token</p>
                <p className="text-gray-500">
                  GET /api/v1/transactions?cardToken={snap?.cardTransactionMaskedPanDisplay?.replace(/\*/g, '') ?? 'tok_...'} -
                  all prior transactions on this card. Enables velocity analysis and merchant pattern review.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="text-purple-500 font-bold mt-0.5">+</span>
              <div>
                <p className="font-medium">HRPC risk profile check</p>
                <p className="text-gray-500">
                  GET /api/v1/fraud/hrpc/check?accountRef=ACC-LF-20240115 -
                  validates customer against High-Risk Person and Counterparty categories (PEP, SIP, fraud history, high-risk jurisdictions).
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="text-purple-500 font-bold mt-0.5">+</span>
              <div>
                <p className="font-medium">Full audit trail</p>
                <p className="text-gray-500">
                  GET /api/v1/fraud/{fraudCase.fraudDiagnosisCaseReference}/events -
                  every action on this case with timestamps, roles, and details.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Raw Atlas document */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-gray-800">Atlas Storage: Raw Document</h2>
            <p className="text-xs text-gray-500 mt-0.5">cardTransactionLog collection</p>
          </div>
          <button
            onClick={onToggleRaw}
            className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg border hover:bg-gray-50 transition-colors"
          >
            {showRaw ? 'Business View' : 'View Raw Atlas Document'}
          </button>
        </div>

        {!showRaw && (
          <p className="text-sm text-gray-500">
            Toggle to see the actual ciphertext stored in Atlas for the linked transaction.
            Even with L2 access, Atlas itself only stores encrypted blobs. Decryption happens
            client-side using the QE library with DEK-sensitive.
          </p>
        )}

        {showRaw && rawDoc && (
          <RawDocumentPanel document={rawDoc.document} collection={rawDoc.collection} />
        )}
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-sm text-purple-900">
        <strong>Key insight:</strong> MongoDB Atlas never sees plaintext PII. The QE client library
        uses CSFLE (Client-Side Field Level Encryption) with DEKs stored in the key vault. L2
        investigators access a separate DEK that covers the additional QE:none fields.
      </div>
    </div>
  );
}

function L2ResolveView({ fraudCase }: { fraudCase: FraudCase }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-semibold text-gray-900">Michael Obi</p>
            <p className="text-xs text-gray-500">Level 2 Fraud Investigator</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          After forensic review, Michael documents his findings, confirms this is confirmed fraud,
          and triggers the resolution workflow.
        </p>

        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="font-semibold text-red-800 mb-2">Fraud Confirmed</p>
          <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
            <li>Transaction originated from an IP address in a different country than the registered address</li>
            <li>Device fingerprint does not match any previously known device</li>
            <li>Merchant flagged in fraud network consortium data</li>
            <li>Card was reported stolen 6 hours after this transaction</li>
          </ul>
        </div>

        <div className="border rounded-lg p-4 bg-gray-50 text-sm space-y-2">
          <p className="font-medium text-gray-700">Resolution Record</p>
          <div className="grid grid-cols-2 gap-1 text-gray-600">
            <span>Conclusion:</span>
            <span className="font-semibold text-red-600">confirmed_fraud</span>
            <span>Actions taken:</span>
            <span>Card blocked, dispute filed, chargeback initiated</span>
            <span>Customer notified:</span>
            <span>Yes (automated + agent call)</span>
            <span>Final status:</span>
            <span>
              <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-medium">resolved_fraud</span>
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-sm text-gray-700 mb-3">Security controls applied</h3>
        <div className="space-y-3 text-sm">
          {[
            { icon: '🔒', title: 'Card token revoked', desc: 'Token invalidated in the vault. Surrogate token, not CHD.' },
            { icon: '📧', title: 'Fraud alert dispatched', desc: 'Customer notified via encrypted channel with resolution details.' },
            { icon: '📋', title: 'Audit log sealed', desc: 'All actions immutably recorded with role, timestamp, and reference.' },
            { icon: '🏦', title: 'Chargeback initiated', desc: 'BIAN SD-83 conclusion propagated to card network via payment gateway.' },
          ].map((item) => (
            <div key={item.title} className="flex gap-3">
              <span className="text-lg mt-0.5">{item.icon}</span>
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-gray-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm">
        <strong>PCI DSS v4.0 compliance:</strong> The complete investigation trail satisfies
        Requirement 10 (audit logging), Requirement 3 (CHD protection at rest via QE), and
        Requirement 7 (role-based access). All sensitive data remains encrypted in Atlas throughout
        the entire workflow.
      </div>
    </div>
  );
}

function CustomerView({ fraudCase }: { fraudCase: FraudCase }) {
  const amount = fraudCase.transactionSnapshot
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: fraudCase.transactionSnapshot.cardTransactionAmount.currency,
      }).format(fraudCase.transactionSnapshot.cardTransactionAmount.amount)
    : 'N/A';

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🧑</span>
          <div>
            <p className="font-semibold text-gray-900">Luis Fernandez</p>
            <p className="text-xs text-gray-500">Affected Customer</p>
          </div>
          <span className="ml-auto bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded">Customer View</span>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Luis logs in after receiving a notification. He sees the outcome of the fraud investigation
          and the protective actions taken on his account.
        </p>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <p className="font-semibold text-green-800 mb-1">Your dispute has been resolved</p>
          <p className="text-sm text-green-700">
            The unauthorized transaction of <strong>{amount}</strong> at{' '}
            <strong>{fraudCase.transactionSnapshot?.cardTransactionMerchantName ?? 'a flagged merchant'}</strong> has been
            confirmed as fraud. A full refund has been issued and a new card will arrive within 5-7 business days.
          </p>
        </div>

        <div className="border rounded-lg p-4 bg-gray-50 text-sm space-y-2">
          <p className="font-medium text-gray-700">What Luis sees</p>
          <div className="grid grid-cols-2 gap-1 text-gray-600">
            <span>Case number:</span>
            <span className="font-mono text-xs">{fraudCase.fraudDiagnosisCaseReference}</span>
            <span>Transaction:</span>
            <span className="text-gray-500">
              {amount} - {fraudCase.transactionSnapshot?.cardTransactionMerchantName ?? 'N/A'}
            </span>
            <span>Outcome:</span>
            <span className="text-green-600 font-medium">Fraud confirmed - full refund</span>
            <span>Card status:</span>
            <span>Cancelled. New card in transit.</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-sm text-gray-700 mb-3">How Luis's data was protected throughout</h3>
        <div className="space-y-3 text-sm">
          {[
            {
              label: 'At rest in Atlas',
              detail: 'Email, phone, account reference stored as QE:equality ciphertext. Address and government ID stored as QE:none ciphertext. Atlas never held plaintext PII.',
              color: 'bg-blue-50 border-blue-200 text-blue-900',
            },
            {
              label: 'During L1 investigation',
              detail: 'Only equality-searchable encrypted fields were accessible. Sensitive PII (address, gov ID) remained locked under the L2 DEK.',
              color: 'bg-amber-50 border-amber-200 text-amber-900',
            },
            {
              label: 'During L2 escalation',
              detail: 'Full PII decrypted client-side only by the authorized L2 investigator application. Decryption happened at the application tier, not in Atlas.',
              color: 'bg-purple-50 border-purple-200 text-purple-900',
            },
            {
              label: 'After resolution',
              detail: 'All investigation actions are immutably logged. Card token revoked. Customer notified. No plaintext data written to logs at any stage.',
              color: 'bg-green-50 border-green-200 text-green-900',
            },
          ].map((item) => (
            <div key={item.label} className={`border rounded-lg p-3 ${item.color}`}>
              <p className="font-semibold text-xs uppercase tracking-wide mb-1">{item.label}</p>
              <p className="text-sm">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#001E2B] text-white rounded-xl p-5 text-sm">
        <p className="text-[#00ED64] font-semibold mb-2">MongoDB QE: End-to-end data security summary</p>
        <ul className="space-y-1 text-gray-300">
          <li>Queryable Encryption lets analysts search encrypted fields without decryption</li>
          <li>Role-based DEK access enforces least-privilege at the cryptographic layer</li>
          <li>PCI DSS Requirements 3, 7, and 10 satisfied with minimal operational overhead</li>
          <li>Atlas never stores, processes, or transmits cardholder data in plaintext</li>
        </ul>
      </div>
    </div>
  );
}
