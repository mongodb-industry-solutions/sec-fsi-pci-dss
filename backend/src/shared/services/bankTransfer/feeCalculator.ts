// v17.1 Bank Transfer: FeeCalculator: config-driven fee per rail (single source of truth).
// SEPA is typically free, ACH low-flat, SWIFT cross-border + correspondent surcharge.
// Pure and reusable; the fee schedule is injectable so an external provider can override it.

import type { BankRail, RailDestination } from './railTypes';
import { config as appConfig } from '../../../config';

export interface RailFeeSchedule {
  sepa: number;
  ach: number;
  swift: number;
  local_bank: number;
  swiftCorrespondentSurcharge: number;  // added when a correspondent BIC is present
}

// Config-driven (single source): the schedule comes from config.payout.railFees (env-tunable).
export const DEFAULT_FEE_SCHEDULE: RailFeeSchedule = {
  sepa: appConfig.payout.railFees.sepa,
  ach: appConfig.payout.railFees.ach,
  swift: appConfig.payout.railFees.swift,
  local_bank: appConfig.payout.railFees.localBank,
  swiftCorrespondentSurcharge: appConfig.payout.railFees.swiftCorrespondentSurcharge,
};

export class FeeCalculator {
  constructor(private readonly schedule: RailFeeSchedule = DEFAULT_FEE_SCHEDULE) {}

  /** Flat fee for a rail, plus SWIFT correspondent surcharge when applicable. */
  calculate(rail: BankRail, destination: RailDestination): number {
    let fee = this.schedule[rail] ?? 0;
    if (rail === 'swift' && destination.correspondentBic) {
      fee += this.schedule.swiftCorrespondentSurcharge;
    }
    return Math.round(fee * 100) / 100;
  }
}

export const feeCalculator = new FeeCalculator();
