// v17.1 Bank Transfer: RailResolver: single source of rail derivation + validation.
// OOP, stateless, reusable. Given a destination (+ optional user override) it derives the
// correct rail (SEPA/ACH/SWIFT/local) and validates the banking coordinates per standard.
// No I/O: safe to unit-test and to call from providers, orchestrator and API alike.

import { isValidIban, isValidBic, isValidRoutingNumber, ibanCountry } from './bankValidators';
import {
  BankRail, RailDestination, RailValidation, SEPA_COUNTRIES,
} from './railTypes';

export class UnsupportedCorridorError extends Error {
  constructor(public readonly destination: RailDestination) {
    super('No supported rail for this country/currency/data combination');
    this.name = 'UnsupportedCorridorError';
  }
}

export class RailResolver {
  /**
   * Derive the rail from destination data unless the user overrode it.
   * Rules (auto-derivation):
   *   EUR + IBAN + SEPA country            -> sepa
   *   USD + routing + account + US         -> ach
   *   BIC present and cross-border/non-SEPA -> swift
   *   IBAN present (any other)             -> swift  (international IBAN wire)
   *   routing + account                    -> ach
   * Throws UnsupportedCorridorError when nothing matches.
   */
  resolve(destination: RailDestination, override?: BankRail): BankRail {
    if (override) return override;

    const country = (destination.countryCode || ibanCountry(destination.iban) || '').toUpperCase();
    const currency = (destination.currency || '').toUpperCase();
    const isSepaCountry = SEPA_COUNTRIES.has(country);

    if (currency === 'EUR' && destination.iban && isSepaCountry) return 'sepa';
    if (currency === 'USD' && destination.routingNumber && destination.accountNumber && country === 'US') return 'ach';
    if (destination.routingNumber && destination.accountNumber && country === 'US') return 'ach';
    if (destination.bic && (!isSepaCountry || destination.correspondentBic)) return 'swift';
    if (destination.iban) return 'swift';

    throw new UnsupportedCorridorError(destination);
  }

  /** Validate that the destination satisfies the requirements of the given rail. */
  validate(rail: BankRail, destination: RailDestination): RailValidation {
    const errors: string[] = [];
    const country = (destination.countryCode || ibanCountry(destination.iban) || '').toUpperCase();
    const currency = (destination.currency || '').toUpperCase();

    switch (rail) {
      case 'sepa':
        if (!isValidIban(destination.iban)) errors.push('A valid IBAN (ISO 13616) is required for SEPA.');
        if (currency !== 'EUR') errors.push('SEPA transfers must be denominated in EUR.');
        if (!SEPA_COUNTRIES.has(country)) errors.push('Destination country is outside the SEPA area.');
        if (destination.bic && !isValidBic(destination.bic)) errors.push('BIC (ISO 9362) is invalid.');
        break;
      case 'ach':
        if (!isValidRoutingNumber(destination.routingNumber)) errors.push('A valid ABA routing number is required for ACH.');
        if (!destination.accountNumber) errors.push('An account number is required for ACH.');
        if (country && country !== 'US') errors.push('ACH is a US-domestic rail.');
        break;
      case 'swift':
        if (!isValidBic(destination.bic)) errors.push('A valid BIC/SWIFT code (ISO 9362) is required for a SWIFT wire.');
        if (destination.correspondentBic && !isValidBic(destination.correspondentBic)) errors.push('Correspondent BIC is invalid.');
        if (!destination.iban && !destination.accountNumber) errors.push('An IBAN or account number is required.');
        break;
      case 'local_bank':
        if (!destination.accountNumber && !destination.iban) errors.push('An account number or IBAN is required.');
        break;
    }

    return { ok: errors.length === 0, rail, errors };
  }

  /** Convenience: derive + validate in one call. */
  resolveAndValidate(destination: RailDestination, override?: BankRail): RailValidation {
    const rail = this.resolve(destination, override);
    return this.validate(rail, destination);
  }
}

// Shared singleton (stateless): reuse rather than re-instantiate per call.
export const railResolver = new RailResolver();
