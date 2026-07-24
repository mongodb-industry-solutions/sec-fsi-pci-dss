// BIAN SD-89 KYB verification saga (v31, §5bis.4). Mirrors PaymentAuthorizationSaga: a scatter-gather
// keyed by correlationId (= merchantAgreementInstanceReference) that collects the entity-level
// completions (kyb_business + hrp_sanctions + aml_monitoring), composes the structured entity verdict,
// persists it via applyKybScreeningVerdict (which also sets the BQ:Step status through the shared
// mapper), then resolves the AGREEMENT per the module's decisionMode (§4.0). Aggregation is in-memory,
// matching the in-process bus. Fail-open on timeout so onboarding is never stuck.

import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent } from '../../../vendors/eventbus';
import { MERCHANT_AGREEMENT_COLLECTION, MerchantAgreementStatus } from '../models/merchantAgreement.model';
import { getCapabilityModuleConfig } from '../../provider/services/capabilityModuleConfig.service';
import { emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import { applyKybScreeningVerdict, getKybDetail } from './merchantKyb.service';
import { appendMerchantEvent } from './merchant.service';
import { effectiveDecisionMode, resolveKybOnboarding, DecisionModeConfig } from '../../../shared/models/onboardingDecision';

const GATE_EVENT: Record<string, string> = {
  'kyb.screening.completed': 'kyb',
  'hrp.screening.completed': 'hrp',
  'aml.screening.completed': 'aml',
};
const EXPECTED_GATES = ['kyb', 'hrp', 'aml'];
const SAGA_TIMEOUT_MS = 8_000;

interface KybJourney {
  businessRiskLevel?: 'low' | 'medium' | 'high';
  sanctionsResult?: 'clear' | 'hit' | 'pending';
  adverseMediaResult?: 'clear' | 'hit' | 'pending';
  screeningProviderRef?: string;
  gatesIn: Set<string>;
  decided: boolean;
  timer?: NodeJS.Timeout;
}

export class KybVerificationSaga {
  private readonly journeys = new Map<string, KybJourney>();

  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(): void {
    this.bus.subscribe('merchant.validation.requested', (e) => this.begin(e));
    for (const type of Object.keys(GATE_EVENT)) this.bus.subscribe(type, (e) => this.onGate(GATE_EVENT[type], e));
  }

  private begin(e: DomainEvent): void {
    const ref = e.correlationId;
    if (this.journeys.has(ref)) return;
    const st: KybJourney = { gatesIn: new Set(), decided: false };
    // Fail-open: resolve with whatever arrived if a provider never completes (e.g. external timeout).
    st.timer = setTimeout(() => { void this.finalize(ref, e.eventId); }, SAGA_TIMEOUT_MS);
    st.timer.unref?.();
    this.journeys.set(ref, st);
  }

  private async onGate(gate: string, e: DomainEvent): Promise<void> {
    const ref = e.correlationId;
    const st = this.journeys.get(ref);
    if (!st || st.decided) return; // not a KYB journey (e.g. a payment-flow hrp completion) → ignore
    const p = e.payload as { businessRiskLevel?: 'low' | 'medium' | 'high'; sanctionsResult?: 'clear' | 'hit' | 'pending'; adverseMediaResult?: 'clear' | 'hit' | 'pending'; screeningProviderRef?: string; outcome?: string; approved?: boolean };

    if (gate === 'kyb') {
      if (p.businessRiskLevel) st.businessRiskLevel = p.businessRiskLevel;
      if (p.sanctionsResult === 'hit') st.sanctionsResult = 'hit';
      if (p.screeningProviderRef) st.screeningProviderRef = p.screeningProviderRef;
    } else if (gate === 'hrp') {
      // hrp.screening.completed uses approved boolean (a match declines). A hit is a hard sanctions hit.
      if (p.approved === false || p.outcome === 'declined') st.sanctionsResult = 'hit';
    } else if (gate === 'aml') {
      if (p.adverseMediaResult) st.adverseMediaResult = p.adverseMediaResult;
    }
    st.gatesIn.add(gate);

    if (EXPECTED_GATES.every((g) => st.gatesIn.has(g))) {
      if (st.timer) clearTimeout(st.timer);
      await this.finalize(ref, e.eventId);
    }
  }

  private async finalize(merchantRef: string, causationId: string): Promise<void> {
    const st = this.journeys.get(merchantRef);
    if (!st || st.decided) return;
    st.decided = true;
    setTimeout(() => this.journeys.delete(merchantRef), 60_000).unref?.();

    // Incomplete evidence (a provider timed out / never responded) must NOT default to clean/low, or the
    // automated path could auto-approve without screening. A missing gate resolves to pending/high so the
    // verdict stays `initiated` and the saga escalates to manual review (fail-open to a SAFE state).
    const businessRiskLevel = st.businessRiskLevel ?? (st.gatesIn.has('kyb') ? 'low' : 'high');
    const adverseMediaResult = st.adverseMediaResult ?? (st.gatesIn.has('aml') ? 'clear' : 'pending');
    let sanctionsResult = st.sanctionsResult ?? (st.gatesIn.has('hrp') ? 'clear' : 'pending');
    const screeningProviderRef = st.screeningProviderRef ?? 'kyb_business:internal';

    // Owner layer (§3.5): a controlling person failing PEP/sanctions raises the merchant's risk.
    let pepHit = false;
    try {
      const detail = await getKybDetail(this.db, merchantRef);
      if (detail.status === 'ok') {
        pepHit = detail.ownerLayerRisk.anyPep;
        if (detail.ownerLayerRisk.anySanctionsHit) sanctionsResult = 'hit';
      }
    } catch { /* owner layer best-effort */ }

    const cfg = (await getCapabilityModuleConfig(this.db, 'kyb').catch(() => null))?.moduleConfig as DecisionModeConfig | undefined;
    const mode = effectiveDecisionMode(cfg);

    // Persist the structured entity verdict + BQ:Step status (shared mapper) in one atomic update.
    await applyKybScreeningVerdict(this.db, merchantRef, { businessRiskLevel, sanctionsResult, adverseMediaResult, screeningProviderRef }, mode).catch(() => false);

    const resolution = resolveKybOnboarding({ businessRiskLevel, sanctionsResult, adverseMediaResult, pepHit }, cfg);

    // Terminal AGREEMENT transition (§5bis.5). Only auto-move a merchant still under_review; never
    // override a merchant an officer already decided. sanctions/PEP can never auto-approve (guardrail).
    let agreementOutcome: 'verified' | 'rejected' | 'under_review' = 'under_review';
    let newStatus: MerchantAgreementStatus | null = null;
    if (resolution.action === 'auto_approve') { newStatus = 'active'; agreementOutcome = 'verified'; }
    else if (resolution.action === 'auto_reject') { newStatus = 'rejected'; agreementOutcome = 'rejected'; }

    if (newStatus) {
      const res = await this.db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
        { merchantAgreementInstanceReference: merchantRef, merchantAgreementStatus: 'under_review' } as never,
        { $set: { merchantAgreementStatus: newStatus, recordUpdatedDateTime: new Date() } },
      );
      if (res.matchedCount === 0) { newStatus = null; agreementOutcome = 'under_review'; } // already decided
    }

    await appendMerchantEvent(this.db, merchantRef, 'kyb.verification.completed', {
      performedByRole: 'system',
      details: { resolution: resolution.action, mode, businessRiskLevel, sanctionsResult, adverseMediaResult, ...(resolution.action === 'recommend' ? { recommended: resolution.recommended } : {}) },
    }).catch(() => {});

    emitComplianceEvent(this.db, {
      entityType: 'merchant',
      entityId: merchantRef,
      processType: 'kyb_verification',
      processAction: 'kyb.verification.completed',
      processOutcome: agreementOutcome === 'verified' ? 'approved' : agreementOutcome === 'rejected' ? 'rejected' : 'pending',
      performedByPartyReference: null,
      performedByRole: 'system',
      eventSummary: { decisionMode: mode, resolution: resolution.action, reason: resolution.reason, businessRiskLevel, sanctionsResult, adverseMediaResult, ...(resolution.action === 'recommend' ? { recommended: resolution.recommended } : {}), ...(newStatus ? { merchantAgreementStatus: newStatus } : {}) },
      bianServiceDomain: 'Merchant Relations',
      bianControlRecordType: 'MerchantAgreementProcedure',
    });

    void this.bus.publish(makeEvent({
      eventType: 'kyb.verification.completed', correlationId: merchantRef, businessProcess: 'merchant_onboarding',
      source: 'saga.kyb-verification', causationId,
      payload: {
        merchantAgreementInstanceReference: merchantRef, outcome: agreementOutcome,
        businessRiskLevel, sanctionsResult, adverseMediaResult, decisionMode: mode, resolution: resolution.action,
        ...(resolution.action === 'recommend' ? { recommended: resolution.recommended } : {}),
      },
      bian: { serviceDomain: 'SD-89 Merchant Relations', controlRecord: 'MerchantAgreementProcedure' },
    }));
  }
}
