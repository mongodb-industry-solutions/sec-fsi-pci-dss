// Builtin Payment Initiation module (SD-66 PISP).
// Simulates a bank transfer: immediately acknowledges with 'submitted', then fires
// a 'settled' callback after the configured T+N delay via the in-process event bus.
// Replaceable by a real PISP/SEPA connector without changing wire contracts or bus events.

import { v4 as uuidv4 } from 'uuid';
import type { PaymentInitiationInbound } from '../../../shared/models/events/wire.contracts';
import { config as appConfig } from '../../../config';

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
}

export interface InitiateTransferResult {
  railRef: string;
  status: 'submitted';
  settlementDelayMs: number;
  willSucceed: boolean;
}

export function initiateTransfer(
  input: InitiateTransferInput,
  config: PaymentInitiationConfig,
): InitiateTransferResult {
  const railRef = `${config.simulateRailPrefix}${uuidv4().slice(0, 8).toUpperCase()}`;
  const delayMs = config.settlementDelayMs[input.settlementSchedule] ?? config.settlementDelayMs['T+1'];

  // Deterministic "random" failure for staging tests when alwaysSucceed=false
  const willSucceed = config.alwaysSucceed || Math.random() > 0.05;

  return {
    railRef,
    status: 'submitted',
    settlementDelayMs: delayMs,
    willSucceed,
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
