/**
 * Unit tests: fraud case OPEN + REOPEN role guards (PCI DSS separation of duties).
 * Source: backend/src/modules/fraud/controllers/fraudDiagnosis.controller.ts
 *
 * The controller delegates the SoD decision to two exported guards:
 *   assertOpenAllowed: may this role OPEN/initiate a case? (POST /fraud)
 *   assertStatusChangeAllowed: may this role CHANGE status, incl. REOPEN? (PATCH /fraud/:id)
 * Both must let L1/L2 through and block the read-only security_auditor with 403.
 */
import { describe, it, expect } from 'vitest';
import { assertOpenAllowed, assertStatusChangeAllowed } from '../../../../../psp/backend/src/modules/fraud/controllers/fraudDiagnosis.controller';

describe('assertOpenAllowed (open a case)', () => {
  it('allows level1_analyst', () => {
    expect(assertOpenAllowed('level1_analyst')).toBeNull();
  });
  it('allows level2_investigator', () => {
    expect(assertOpenAllowed('level2_investigator')).toBeNull();
  });
  it('blocks security_auditor with 403', () => {
    expect(assertOpenAllowed('security_auditor')).toEqual({ error: expect.any(String), status: 403 });
  });
});

describe('assertStatusChangeAllowed (reopen / status change)', () => {
  it('allows level1_analyst to change status (e.g. closed -> open)', () => {
    expect(assertStatusChangeAllowed('level1_analyst')).toBeNull();
  });
  it('allows level2_investigator to change status (e.g. closed -> open)', () => {
    expect(assertStatusChangeAllowed('level2_investigator')).toBeNull();
  });
  it('blocks security_auditor with 403 (read-only)', () => {
    expect(assertStatusChangeAllowed('security_auditor')).toEqual({ error: expect.any(String), status: 403 });
  });
});
