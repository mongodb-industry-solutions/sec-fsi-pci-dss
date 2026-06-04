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

// Static demo ciphertext for simulator (no JWT available in this mode)
const DEMO_RAW_TRANSACTION: Record<string, unknown> = {
  _id: { $oid: '6650a2b3c4d5e6f700000001' },
  cardTransactionInstanceReference: 'a7f3d891-2c45-4b67-8e12-9f0a1b2c3d4e',
  cardTransactionAccountReference: {
    $binary: { base64: 'BhKJ9KMsQfY7lP+2Xa8nDEz1rVwCqI5uH0TbGmOjS6Ry==', subType: '06' },
  },
  paymentCardReference: 'tok_sim_7xB2kp1q',
  cardTransactionAmount: { amount: 850, currency: 'USD' },
  cardTransactionDateTime: '2026-06-04T14:32:17.000Z',
  cardTransactionStatus: 'authorized',
  cardTransactionMaskedPanDisplay: '****-****-****-4291',
  cardTransactionMerchantName: 'Casino Royale',
  cardTransactionMerchantCategoryCode: '7995',
  schemaVersion: 1,
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
          'cardTransaction',
          fraudCase.linkedCardTransactionReference,
          ''
        );
        setRawDoc(doc);
      } catch {
        // Expected in simulator (no JWT). Use static demo ciphertext.
        setRawDoc({ collection: 'cardTransaction', document: DEMO_RAW_TRANSACTION });
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

        {/* Data visibility: L1 vs L2 */}
        <h3 className="font-semibold text-sm text-gray-700 mb-2">Customer Data Access by Role</h3>
        <div className="rounded-lg border divide-y text-sm">
          <div className="px-3 py-2 bg-blue-50">
            <p className="text-xs font-semibold text-blue-700 uppercase mb-1">L1 can search (encrypted)</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Email" type="qe-equality" />
                <span className="text-gray-500 text-xs">QE equality search - value hidden until searched</span>
              </div>
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Phone" type="qe-equality" />
                <span className="text-gray-500 text-xs">QE equality search - value hidden until searched</span>
              </div>
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Account Reference" type="qe-equality" />
                <span className="text-gray-500 text-xs">QE equality search - value hidden until searched</span>
              </div>
            </div>
          </div>
          <div className="px-3 py-2 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">L2 only (QE:none - encrypted, not searchable)</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Physical Address" type="qe-none" />
                <span className="text-gray-400 text-xs">Requires Level 2 escalation</span>
              </div>
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Government ID" type="qe-none" />
                <span className="text-gray-400 text-xs">Requires Level 2 escalation</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Atlas raw document (L1 perspective) */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">What Atlas Stores</h2>
          <button
            onClick={onToggleRaw}
            className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg border hover:bg-gray-50 transition-colors"
          >
            {showRaw ? 'Hide Raw Document' : 'View Raw Atlas Document'}
          </button>
        </div>
        {!showRaw && (
          <p className="text-sm text-gray-500">
            Click to see the actual document stored in Atlas for this transaction.
            QE-encrypted fields appear as binary ciphertext - neither L1 nor Atlas can read them without the client-side key.
          </p>
        )}
        {showRaw && rawDoc && (
          <RawDocumentPanel document={rawDoc.document} collection={rawDoc.collection} />
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>MongoDB QE in action:</strong> Sarah can search by email, phone, or account reference
        using Queryable Encryption. Atlas receives and matches ciphertext-to-ciphertext.
        Plaintext never reaches the server.
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
          Michael receives the escalation from Sarah. With L2 credentials, the QE client decrypts
          the additional PII fields. Full forensic data is now available.
        </p>

        {/* Transaction summary at L2 */}
        {fraudCase.transactionSnapshot && (
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <h3 className="font-semibold text-sm text-gray-700 mb-2">Transaction Details</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-gray-500">Amount:</span>
              <span className="font-semibold text-red-700">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: fraudCase.transactionSnapshot.cardTransactionAmount.currency,
                }).format(fraudCase.transactionSnapshot.cardTransactionAmount.amount)}
              </span>
              <span className="text-gray-500">Merchant:</span>
              <span>{fraudCase.transactionSnapshot.cardTransactionMerchantName}</span>
              <span className="text-gray-500">Card (masked):</span>
              <span className="font-mono">{fraudCase.transactionSnapshot.cardTransactionMaskedPanDisplay}</span>
              <span className="text-gray-500">Date / Time:</span>
              <span>{new Date(fraudCase.transactionSnapshot.cardTransactionDateTime).toLocaleString()}</span>
            </div>
          </div>
        )}

        <h3 className="font-semibold text-sm text-gray-700 mb-2">Customer Profile: Extended L2 View</h3>
        <div className="rounded-lg border divide-y text-sm">
          <div className="px-3 py-2 bg-blue-50">
            <p className="text-xs font-semibold text-blue-700 uppercase mb-1.5">QE:equality fields (L1 + L2)</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Email" type="qe-equality" />
                <span className="text-green-700 font-mono text-xs">luis.fernandez@leafybank.demo</span>
              </div>
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Phone" type="qe-equality" />
                <span className="text-green-700 font-mono text-xs">+1-555-0142</span>
              </div>
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Account Reference" type="qe-equality" />
                <span className="text-green-700 font-mono text-xs">ACC-LF-20240115</span>
              </div>
            </div>
          </div>
          <div className="px-3 py-2 bg-purple-50">
            <p className="text-xs font-semibold text-purple-700 uppercase mb-1.5">QE:none fields (L2 only - decrypted after escalation)</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Physical Address" type="qe-none" />
                <span className="text-green-700 font-mono text-xs">742 Evergreen Terrace, Springfield</span>
              </div>
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Government ID" type="qe-none" />
                <span className="text-green-700 font-mono text-xs">XXX-XX-4821 (masked)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Raw Atlas document */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Atlas Storage: Raw Document</h2>
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
            Even with L2 access, Atlas itself only stores encrypted blobs; decryption happens client-side.
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
