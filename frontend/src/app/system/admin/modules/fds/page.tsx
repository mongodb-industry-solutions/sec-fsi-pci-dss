'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldAlert, Save, Plus, Trash2, ListChecks } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../lib/permissions';
import { Tooltip } from '../../../../../components/Tooltip';

// Dedicated config UI for the internal FDS (fraud-detection) engine (overrides the generic module
// editor for this capability). The rules are DATA-DRIVEN and stored in the capability moduleConfig;
// the backend /modules/fds/score endpoint evaluates them on every transaction. An operator can add
// or edit rules here without code (P13.5). PCI DSS (config change is audited).

const CAP = 'fds';

type RuleOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne' | 'in' | 'nin';
const OPS: RuleOp[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'ne', 'in', 'nin'];
const OP_LABEL: Record<RuleOp, string> = {
  gt: '> greater than', gte: '≥ at least', lt: '< less than', lte: '≤ at most',
  eq: '= equals', ne: '≠ not equals', in: 'in list', nin: 'not in list',
};

interface RuleForm {
  id: string;
  label: string;
  field: string;
  op: RuleOp;
  value: string;       // raw text in the form; coerced on save (number / string / csv list)
  score: number;
  action: '' | 'review' | 'decline';
  enabled: boolean;
}

// Mirror of the backend default rule set (resolveFdsRules), shown when no config is stored yet.
const DEFAULT_RULES: RuleForm[] = [
  { id: 'HIGH_VALUE_TXN', label: 'Amount over 500', field: 'amount', op: 'gt', value: '500', score: 60, action: 'review', enabled: true },
  { id: 'ELEVATED_VALUE_TXN', label: 'Amount over 250', field: 'amount', op: 'gt', value: '250', score: 40, action: '', enabled: true },
  { id: 'RISKY_MCC', label: 'Merchant category on the risky list', field: 'merchantCategoryCode', op: 'in', value: '5812, 6011, 7995', score: 35, action: 'review', enabled: true },
  { id: 'VELOCITY_24H', label: 'More than 5 transactions in 24h', field: 'recentTransactionCount24h', op: 'gt', value: '5', score: 30, action: 'review', enabled: true },
];

function rulesToForm(rules: unknown): RuleForm[] {
  if (!Array.isArray(rules) || rules.length === 0) return DEFAULT_RULES;
  return rules.map((r) => {
    const rr = r as { id?: string; label?: string; when?: { field?: string; op?: string; value?: unknown }; score?: number; action?: string; enabled?: boolean };
    const value = Array.isArray(rr.when?.value) ? (rr.when?.value as unknown[]).join(', ') : String(rr.when?.value ?? '');
    return {
      id: String(rr.id ?? ''),
      label: String(rr.label ?? ''),
      field: String(rr.when?.field ?? 'amount'),
      op: (OPS.includes(rr.when?.op as RuleOp) ? rr.when?.op : 'gt') as RuleOp,
      value,
      score: typeof rr.score === 'number' ? rr.score : 0,
      action: (rr.action === 'review' || rr.action === 'decline' ? rr.action : '') as RuleForm['action'],
      enabled: rr.enabled !== false,
    };
  });
}

// Coerce the form value to the stored type: a list for in/nin, a number when numeric, else a string.
function coerceValue(op: RuleOp, raw: string): number | string | Array<number | string> {
  if (op === 'in' || op === 'nin') {
    return raw.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (Number.isFinite(Number(x)) && x !== '' ? x : x));
  }
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? n : raw.trim();
}

export default function FdsModulePage() {
  const token = getToken() ?? '';
  const notify = useNotify();
  const { can } = useEffectivePermissions();
  const canEdit = can('modules', 'manage'); // manager has modules:view only; only operations_officer may edit

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewAmount, setReviewAmount] = useState(500);
  const [declineAmount, setDeclineAmount] = useState('');     // optional
  const [riskyMcc, setRiskyMcc] = useState('5812, 6011, 7995');
  const [window24hMax, setWindow24hMax] = useState('5');       // optional
  const [reviewAtOrAbove, setReviewAtOrAbove] = useState(50);
  const [declineAtOrAbove, setDeclineAtOrAbove] = useState('120'); // optional
  const [rules, setRules] = useState<RuleForm[]>(DEFAULT_RULES);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const c = await api.modules.getConfig(CAP, token);
        const mc = (c?.moduleConfig as Record<string, unknown>) ?? {};
        const amount = (mc.amount as { reviewAmount?: number; declineAmount?: number }) ?? {};
        const bands = (mc.bands as { reviewAtOrAbove?: number; declineAtOrAbove?: number }) ?? {};
        const velocity = (mc.velocity as { window24hMax?: number }) ?? {};
        setReviewAmount(typeof amount.reviewAmount === 'number' ? amount.reviewAmount : 500);
        setDeclineAmount(typeof amount.declineAmount === 'number' ? String(amount.declineAmount) : '');
        setRiskyMcc(Array.isArray(mc.riskyMcc) ? (mc.riskyMcc as unknown[]).join(', ') : '5812, 6011, 7995');
        setWindow24hMax(typeof velocity.window24hMax === 'number' ? String(velocity.window24hMax) : '');
        setReviewAtOrAbove(typeof bands.reviewAtOrAbove === 'number' ? bands.reviewAtOrAbove : 50);
        setDeclineAtOrAbove(typeof bands.declineAtOrAbove === 'number' ? String(bands.declineAtOrAbove) : '');
        setRules(rulesToForm(mc.rules));
      } catch {
        setRules(DEFAULT_RULES);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  function updateRule(i: number, patch: Partial<RuleForm>) {
    setRules((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRule() {
    setRules((prev) => [...prev, { id: `RULE_${prev.length + 1}`, label: '', field: 'amount', op: 'gt', value: '0', score: 20, action: '', enabled: true }]);
  }
  function removeRule(i: number) {
    setRules((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    try {
      const moduleConfig: Record<string, unknown> = {
        amount: {
          reviewAmount,
          ...(declineAmount.trim() && Number.isFinite(Number(declineAmount)) ? { declineAmount: Number(declineAmount) } : {}),
        },
        riskyMcc: riskyMcc.split(',').map((x) => x.trim()).filter(Boolean),
        ...(window24hMax.trim() && Number.isFinite(Number(window24hMax)) ? { velocity: { window24hMax: Number(window24hMax) } } : {}),
        bands: {
          reviewAtOrAbove,
          ...(declineAtOrAbove.trim() && Number.isFinite(Number(declineAtOrAbove)) ? { declineAtOrAbove: Number(declineAtOrAbove) } : {}),
        },
        rules: rules
          .filter((r) => r.id.trim())
          .map((r) => ({
            id: r.id.trim(),
            label: r.label.trim() || r.id.trim(),
            when: { field: r.field.trim(), op: r.op, value: coerceValue(r.op, r.value) },
            score: r.score,
            ...(r.action ? { action: r.action } : {}),
            enabled: r.enabled,
          })),
        scoreScaleMax: 100,
      };
      await api.modules.updateConfig(CAP, moduleConfig, token);
      notify('FDS rules saved', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'Fraud Detection (FDS)' }]} />
      <SectionHeader
        icon={ShieldAlert}
        title="Fraud Detection (FDS); Internal Module"
        description="Data-driven fraud scoring. Each rule fires when a transaction field meets its condition, contributing points; the total maps to approve / review / decline via the score bands. Add or edit rules to tune the engine without code."
        debugInfo="capability=fds Fraud Evaluation · PCI DSS (config audited)"
      />

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {!canEdit && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
              Read-only: your role can view this configuration but not change it (requires <code className="font-mono text-xs">modules:manage</code>).
            </div>
          )}
          <fieldset disabled={!canEdit} className="space-y-5 border-0 p-0 m-0 min-w-0">
          {/* Thresholds + bands */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="font-semibold text-gray-800 text-sm">Thresholds &amp; score bands</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Review amount<Tooltip text="Transaction amount at/over which the HIGH_VALUE_TXN rule fires and flags the transaction for review. Single source of truth shared with the fraud-case threshold." /></label>
                <input type="number" value={reviewAmount} onChange={(e) => setReviewAmount(Number(e.target.value) || 0)}
                  className="w-32 border rounded-lg px-3 py-2 text-sm font-mono" />
                <p className="text-xs text-gray-500 mt-1">Single source of truth for the amount threshold (shared with the fraud-case rule).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Decline amount <span className="text-gray-400">(optional)</span><Tooltip text="Amount at/over which the VERY_HIGH_VALUE_TXN rule forces an auto-decline. Leave blank to never auto-decline based on amount alone." /></label>
                <input type="number" value={declineAmount} onChange={(e) => setDeclineAmount(e.target.value)}
                  className="w-32 border rounded-lg px-3 py-2 text-sm font-mono" placeholder="—" />
                <p className="text-xs text-gray-500 mt-1">Amount at/over which a transaction is auto-declined. Leave blank to never auto-decline on amount.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Velocity: max txns / 24h <span className="text-gray-400">(optional)</span><Tooltip text="The VELOCITY_24H rule fires when the number of transactions in the last 24h exceeds this count (only when that signal is supplied to the engine)." /></label>
                <input type="number" value={window24hMax} onChange={(e) => setWindow24hMax(e.target.value)}
                  className="w-32 border rounded-lg px-3 py-2 text-sm font-mono" placeholder="—" />
                <p className="text-xs text-gray-500 mt-1">Fires the velocity rule above this count (when the signal is supplied).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Review at score ≥<Tooltip text="Aggregate risk-score band: at/above this total the recommendation becomes 'review' (even if no single rule forced it)." /></label>
                <input type="number" value={reviewAtOrAbove} onChange={(e) => setReviewAtOrAbove(Number(e.target.value) || 0)}
                  className="w-32 border rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Decline at score ≥ <span className="text-gray-400">(optional)</span><Tooltip text="Aggregate risk-score band: at/above this total the recommendation becomes 'decline'. Leave blank to never auto-decline purely on the aggregate score." /></label>
                <input type="number" value={declineAtOrAbove} onChange={(e) => setDeclineAtOrAbove(e.target.value)}
                  className="w-32 border rounded-lg px-3 py-2 text-sm font-mono" placeholder="—" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Risky MCC list<Tooltip text="Merchant Category Codes (comma-separated) used by the RISKY_MCC rule; a transaction whose MCC is in this list scores extra risk and is flagged for review." /></label>
                <input value={riskyMcc} onChange={(e) => setRiskyMcc(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="5812, 6011, 7995" />
                <p className="text-xs text-gray-500 mt-1">Merchant category codes used by the <code>RISKY_MCC</code> rule (comma-separated).</p>
              </div>
            </div>
          </div>

          {/* Rules table (extensible) */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">Scoring rules<Tooltip text="Data-driven rules evaluated on every transaction. Each rule fires when its field/operator/value condition matches, adding its score; the aggregate score and any forced action produce the approve/review/decline recommendation." /></h2>
              <button onClick={addRule} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:border-gray-500 text-gray-700 transition-colors">
                <Plus size={13} /> Add rule
              </button>
            </div>
            <p className="text-xs text-gray-500">
              A rule fires when the chosen transaction <code>field</code> satisfies the <code>operator</code> against the <code>value</code>. Fired rules add their <code>score</code>; an optional forced <code>action</code> (review/decline) overrides the bands. For <em>in / not in list</em>, value is comma-separated.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase border-b">
                    <th className="py-2 pr-3 font-medium">Rule id</th>
                    <th className="py-2 pr-3 font-medium">Label</th>
                    <th className="py-2 pr-3 font-medium">Field</th>
                    <th className="py-2 pr-3 font-medium">Operator</th>
                    <th className="py-2 pr-3 font-medium">Value</th>
                    <th className="py-2 pr-3 font-medium">Score</th>
                    <th className="py-2 pr-3 font-medium">Action</th>
                    <th className="py-2 pr-3 font-medium">On</th>
                    <th className="py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-3"><input value={r.id} onChange={(e) => updateRule(i, { id: e.target.value })} className="w-36 border rounded px-2 py-1 text-sm font-mono" placeholder="RULE_ID" /></td>
                      <td className="py-2 pr-3"><input value={r.label} onChange={(e) => updateRule(i, { label: e.target.value })} className="w-44 border rounded px-2 py-1 text-sm" placeholder="Description" /></td>
                      <td className="py-2 pr-3"><input value={r.field} onChange={(e) => updateRule(i, { field: e.target.value })} className="w-40 border rounded px-2 py-1 text-sm font-mono" placeholder="amount" /></td>
                      <td className="py-2 pr-3">
                        <select value={r.op} onChange={(e) => updateRule(i, { op: e.target.value as RuleOp })} className="border rounded px-2 py-1 text-sm">
                          {OPS.map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
                        </select>
                      </td>
                      <td className="py-2 pr-3"><input value={r.value} onChange={(e) => updateRule(i, { value: e.target.value })} className="w-32 border rounded px-2 py-1 text-sm font-mono" placeholder="500" /></td>
                      <td className="py-2 pr-3"><input type="number" value={r.score} onChange={(e) => updateRule(i, { score: Number(e.target.value) || 0 })} className="w-20 border rounded px-2 py-1 text-sm font-mono" /></td>
                      <td className="py-2 pr-3">
                        <select value={r.action} onChange={(e) => updateRule(i, { action: e.target.value as RuleForm['action'] })} className="border rounded px-2 py-1 text-sm">
                          <option value="">score only</option>
                          <option value="review">review</option>
                          <option value="decline">decline</option>
                        </select>
                      </td>
                      <td className="py-2 pr-3"><input type="checkbox" checked={r.enabled} onChange={(e) => updateRule(i, { enabled: e.target.checked })} className="rounded" /></td>
                      <td className="py-2 text-right"><button onClick={() => removeRule(i)} className="text-gray-400 hover:text-red-600 transition-colors" title="Remove rule"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium disabled:opacity-60">
              <Save size={14} />{saving ? 'Saving…' : 'Save rules'}
            </button>
            <Link href="/system/audit-events" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
              <ListChecks size={14} /> View scoring logs in audit events
            </Link>
          </div>
          </fieldset>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 mt-5">
            <strong>How it scores: </strong> every transaction is evaluated against the enabled rules. The fired rules&rsquo; scores sum to the risk score; the bands map it to approve / review / decline, and any forced action wins. The verdict drives the fraud case (its score and severity), and the rules that fired are recorded in the audit trail. No PAN or CVV is ever used in scoring (PCI DSS).
          </div>
        </>
      )}
    </div>
  );
}
