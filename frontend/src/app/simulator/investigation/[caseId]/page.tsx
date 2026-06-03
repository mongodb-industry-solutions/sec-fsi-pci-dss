'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, RawDocumentResponse } from '../../../../lib/api';
import { EncryptionBadge } from '../../../../components/EncryptionBadge';
import { RawDocumentPanel } from '../../../../components/RawDocumentPanel';
import { SEVERITY_COLORS, STATUS_COLORS } from '../../../../lib/constants';

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
    icon: '👤',
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
    icon: '🔍',
    description: 'Investigator Michael Obi receives the escalation and conducts a full forensic review with elevated data access.',
  },
  {
    id: 'l2-resolve',
    label: 'L2 Resolution',
    role: 'Level 2 Investigator',
    icon: '✅',
    description: 'Michael documents findings, confirms fraud, and triggers the resolution workflow.',
  },
  {
    id: 'customer-view',
    label: 'Customer Notification',
    role: 'Customer (Luis)',
    icon: '🧑',
    description: 'Luis Fernandez receives the outcome: transaction disputed, card replaced, data protected.',
  },
];

export default function SimulatorCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [rawDoc, setRawDoc] = useState<RawDocumentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rawLoading, setRawLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<StepId>('l1-open');

  useEffect(() => {
    api.fraud.getById(caseId, '')
      .then(setFraudCase)
      .catch(() => setFraudCase(null))
      .finally(() => setLoading(false));
  }, [caseId]);

  async function toggleRaw() {
    if (!showRaw && !rawDoc && fraudCase) {
      setRawLoading(true);
      try {
        const doc = await api.system.rawDocument(
          'cardTransaction',
          fraudCase.linkedCardTransactionReference,
          ''
        );
        setRawDoc(doc);
      } catch {
        setRawDoc(null);
      } finally {
        setRawLoading(false);
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
        <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
          <div><span className="font-medium">Transaction ID:</span></div>
          <div className="font-mono text-xs truncate">
            {fraudCase.linkedCardTransactionReference
              ? `${fraudCase.linkedCardTransactionReference.slice(0, 20)}...`
              : 'N/A'}
          </div>
          <div><span className="font-medium">Risk Indicators:</span></div>
          <div>{fraudCase.fraudDiagnosisAssessment?.riskIndicators.join(', ') ?? 'N/A'}</div>
          <div><span className="font-medium">Risk Score:</span></div>
          <div>{fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore ?? 'N/A'}/100</div>
        </div>
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
          <span className="text-2xl">{step.icon === 'escalate' ? '⬆️' : step.icon}</span>
          <div>
            <p className="font-semibold text-[#00ED64] text-sm">{step.role}</p>
            <p className="text-gray-300 text-sm mt-0.5">{step.description}</p>
          </div>
        </div>
      </div>

      {/* Step content */}
      {currentStep === 'l1-open' && (
        <L1OpenView fraudCase={fraudCase} />
      )}
      {currentStep === 'l1-escalate' && (
        <L1EscalateView fraudCase={fraudCase} />
      )}
      {currentStep === 'l2-review' && (
        <L2ReviewView
          fraudCase={fraudCase}
          showRaw={showRaw}
          rawDoc={rawDoc}
          rawLoading={rawLoading}
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

function L1OpenView({ fraudCase }: { fraudCase: FraudCase }) {
  return (
    <div className="space-y-4">
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
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 mb-4">
          Flag: High-risk merchant (MCC 7995 - Gambling) combined with unusual transaction velocity.
        </div>
        <h3 className="font-semibold text-sm text-gray-700 mb-2">Data visible to L1 Analyst:</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <EncryptionBadge label="Customer Email" type="qe-equality" />
            <span className="text-gray-500 italic">equality-searchable, never decrypted at rest</span>
          </div>
          <div className="flex items-center gap-2">
            <EncryptionBadge label="Customer Phone" type="qe-equality" />
            <span className="text-gray-500 italic">equality-searchable, never decrypted at rest</span>
          </div>
          <div className="flex items-center gap-2">
            <EncryptionBadge label="Account Reference" type="qe-equality" />
            <span className="text-gray-500 italic">equality-searchable, never decrypted at rest</span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t space-y-2 text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <span>🔒</span>
            <strong>Physical Address:</strong>
            <span className="italic">Requires L2 escalation (QE:none)</span>
          </div>
          <div className="flex items-center gap-2">
            <span>🔒</span>
            <strong>Government ID:</strong>
            <span className="italic">Requires L2 escalation (QE:none)</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-sm text-gray-700 mb-3">Transaction Details (L1 view)</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-gray-500">Case Reference:</span>
          <span className="font-mono">{fraudCase.fraudDiagnosisCaseReference}</span>
          <span className="text-gray-500">Risk Score:</span>
          <span className="font-semibold text-red-600">
            {fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore ?? 'N/A'}/100
          </span>
          <span className="text-gray-500">Risk Indicators:</span>
          <span>{fraudCase.fraudDiagnosisAssessment?.riskIndicators.join(', ') ?? 'N/A'}</span>
          <span className="text-gray-500">Opened:</span>
          <span>{fraudCase.requestDateTime ? new Date(fraudCase.requestDateTime).toLocaleString() : 'N/A'}</span>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>MongoDB QE in action:</strong> Sarah can search by email, phone, or account reference
        using MongoDB Queryable Encryption. Atlas receives ciphertext queries and returns ciphertext
        results. Plaintext never leaves the application tier.
      </div>
    </div>
  );
}

function L1EscalateView({ fraudCase }: { fraudCase: FraudCase }) {
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
            <li>Risk score {fraudCase.fraudDiagnosisAssessment?.fraudDiagnosisScore ?? 'N/A'}/100 exceeds L1 threshold (70)</li>
            <li>Transaction involves high-risk MCC code</li>
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
            <span>Priority:</span><span className="font-semibold text-red-600">{fraudCase.riskSeverity.toUpperCase()}</span>
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
  rawLoading,
  onToggleRaw,
}: {
  fraudCase: FraudCase;
  showRaw: boolean;
  rawDoc: RawDocumentResponse | null;
  rawLoading: boolean;
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

        <h3 className="font-semibold text-sm text-gray-700 mb-2">Extended data visible at L2:</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <EncryptionBadge label="Customer Email" type="qe-equality" />
            <span className="text-green-600 font-mono text-xs">luis.fernandez@leafybank.demo</span>
          </div>
          <div className="flex items-center gap-2">
            <EncryptionBadge label="Customer Phone" type="qe-equality" />
            <span className="text-green-600 font-mono text-xs">+1-555-0142</span>
          </div>
          <div className="flex items-center gap-2">
            <EncryptionBadge label="Account Reference" type="qe-equality" />
            <span className="text-green-600 font-mono text-xs">ACC-LF-20240115</span>
          </div>
          <div className="flex items-center gap-2 mt-2 pt-2 border-t">
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-medium">QE:none / L2 only</span>
            <span className="font-medium text-sm">Physical Address:</span>
            <span className="text-green-600 text-xs font-mono">742 Evergreen Terrace, Springfield</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-medium">QE:none / L2 only</span>
            <span className="font-medium text-sm">Government ID:</span>
            <span className="text-green-600 text-xs font-mono">XXX-XX-4821 (masked)</span>
          </div>
        </div>
      </div>

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

        {rawLoading && <div className="text-sm text-gray-400">Fetching raw document from Atlas...</div>}

        {!showRaw && !rawLoading && (
          <p className="text-sm text-gray-500">
            Toggle to see the actual ciphertext stored in Atlas for the linked transaction.
            Even with L2 access, Atlas itself only stores encrypted blobs; decryption happens client-side.
          </p>
        )}

        {showRaw && rawDoc && (
          <RawDocumentPanel document={rawDoc.document} collection={rawDoc.collection} />
        )}

        {showRaw && !rawDoc && !rawLoading && (
          <div className="bg-gray-900 text-green-300 rounded-lg p-4 font-mono text-xs">
            <div className="text-gray-400 mb-2">Atlas . cardTransaction . ciphertext</div>
            <pre>{`{
  "_id": "...",
  "cardTransactionAccountReference": {
    "$binary": { "base64": "BhKJ9KMs...", "subType": "06" }
  },
  "paymentCardReference": "tok_7xB2kp1q",
  "cardTransactionAmount": { "amount": 850, "currency": "USD" }
}`}</pre>
          </div>
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
            <li>Merchant (MCC 7995) flagged in fraud network consortium data</li>
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
            { icon: '🔒', title: 'Card token revoked', desc: 'tok_7xB2kp1q invalidated in the token vault. Surrogate token, not CHD.' },
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
            The unauthorized transaction of <strong>$850.00</strong> at a gambling merchant has been
            confirmed as fraud. A full refund has been issued and a new card will arrive within 5-7 business days.
          </p>
        </div>

        <div className="border rounded-lg p-4 bg-gray-50 text-sm space-y-2">
          <p className="font-medium text-gray-700">What Luis sees</p>
          <div className="grid grid-cols-2 gap-1 text-gray-600">
            <span>Case number:</span>
            <span className="font-mono text-xs">{fraudCase.fraudDiagnosisCaseReference}</span>
            <span>Transaction:</span>
            <span className="text-gray-500">$850.00 - Gambling merchant</span>
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
