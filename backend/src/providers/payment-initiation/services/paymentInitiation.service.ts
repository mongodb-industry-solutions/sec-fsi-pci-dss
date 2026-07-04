// Builtin Payment Initiation module (SD-66 PISP).
// Simulates a bank transfer: immediately acknowledges with 'submitted', then fires
// a 'settled' callback after the configured T+N delay via the in-process event bus.
// Replaceable by a real PISP/SEPA connector without changing wire contracts or bus events.

import { v4 as uuidv4 } from 'uuid';
import type { PaymentInitiationInbound } from '../../../shared/models/events/wire.contracts';
import { config as appConfig } from '../../../config';
import {
  railResolver, feeCalculator,
  type BankRail, type RailDestination, type RecurringMandate,
} from '../../../shared/services/bankTransfer';

export interface PaymentInitiationConfig {
  settlementDelayMs: {
    'T+0': number;
    'T+1': number;
    'T+2': number;
    'T+3': number;
  };
  alwaysSucceed: boolean;
  simulateRailPrefix: string;
}

export const DEFAULT_PAYMENT_INITIATION_CONFIG: PaymentInitiationConfig = {
  settlementDelayMs: {
    'T+0': appConfig.payout.settlementDelayT1Ms === 0 ? 0 : 0,
    'T+1': appConfig.payout.settlementDelayT1Ms,
    'T+2': appConfig.payout.settlementDelayT2Ms,
    'T+3': appConfig.payout.settlementDelayT3Ms,
  },
  alwaysSucceed: appConfig.payout.paymentInitiationAlwaysSucceed,
  simulateRailPrefix: 'SIM-',
};

export function resolvePaymentInitiationConfig(
  stored: Record<string, unknown> | undefined | null,
): PaymentInitiationConfig {
  const c = (stored ?? {}) as Partial<PaymentInitiationConfig>;
  return {
    settlementDelayMs: (c.settlementDelayMs && typeof c.settlementDelayMs === 'object')
      ? { ...DEFAULT_PAYMENT_INITIATION_CONFIG.settlementDelayMs, ...(c.settlementDelayMs as object) }
      : DEFAULT_PAYMENT_INITIATION_CONFIG.settlementDelayMs,
    alwaysSucceed: typeof c.alwaysSucceed === 'boolean' ? c.alwaysSucceed : DEFAULT_PAYMENT_INITIATION_CONFIG.alwaysSucceed,
    simulateRailPrefix: typeof c.simulateRailPrefix === 'string' ? c.simulateRailPrefix : DEFAULT_PAYMENT_INITIATION_CONFIG.simulateRailPrefix,
  };
}

export type SettlementSchedule = 'T+0' | 'T+1' | 'T+2' | 'T+3';

export interface InitiateTransferInput {
  clientReference: string;
  paymentExecutionInstanceReference: string;
  amount: number;
  currency: string;
  settlementSchedule: SettlementSchedule;
  // v17.1: rail + destination let the builtin PISP derive/validate the rail and price the fee.
  // Optional so existing callers (internal_ledger P2P) keep working unchanged.
  rail?: BankRail;                  // user override; when absent it is auto-derived
  destination?: RailDestination;    // banking coordinates (resolved by the orchestrator)
  recurring?: RecurringMandate;     // ACH SDD / SEPA SDD mandate
}

export interface InitiateTransferResult {
  railRef: string;
  status: 'submitted';
  settlementDelayMs: number;
  willSucceed: boolean;
  rail?: BankRail;                  // the rail actually used (derived or overridden)
  feeAmount?: number;
  feeCurrency?: string;
  validationErrors?: string[];      // non-empty => the destination failed validation (no submit)
}

export function initiateTransfer(
  input: InitiateTransferInput,
  config: PaymentInitiationConfig,
): InitiateTransferResult {
  const railRef = `${config.simulateRailPrefix}${uuidv4().slice(0, 8).toUpperCase()}`;
  const delayMs = config.settlementDelayMs[input.settlementSchedule] ?? config.settlementDelayMs['T+1'];

  // v17.1: when a destination is supplied, derive + validate the rail and price the fee.
  let rail: BankRail | undefined;
  let feeAmount: number | undefined;
  if (input.destination) {
    rail = railResolver.resolve(input.destination, input.rail);
    const validation = railResolver.validate(rail, input.destination);
    if (!validation.ok) {
      return { railRef, status: 'submitted', settlementDelayMs: delayMs, willSucceed: false, rail, validationErrors: validation.errors };
    }
    feeAmount = feeCalculator.calculate(rail, input.destination);
  }

  // Deterministic "random" failure for staging tests when alwaysSucceed=false
  const willSucceed = config.alwaysSucceed || Math.random() > 0.05;

  return {
    railRef,
    status: 'submitted',
    settlementDelayMs: delayMs,
    willSucceed,
    ...(rail ? { rail } : {}),
    ...(feeAmount !== undefined ? { feeAmount, feeCurrency: input.currency } : {}),
  };
}

export function buildSettledInbound(railRef: string, clientReference: string): PaymentInitiationInbound {
  return {
    clientReference,
    railRef,
    status: 'settled',
    completedAt: new Date().toISOString(),
  };
}

export function buildFailedInbound(railRef: string, clientReference: string): PaymentInitiationInbound {
  return {
    clientReference,
    railRef,
    status: 'failed',
    completedAt: new Date().toISOString(),
    errorCode: 'RAIL_FAILURE',
    errorReason: 'Simulated rail failure (alwaysSucceed=false)',
  };
}
