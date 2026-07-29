/**
 * Unit tests: v32 C2/C6 reveal disclosure audit and capability-granted sensitive tier (tests 22, 27)
 * Source: backend/src/modules/customer/services/customerAgreement.service.ts
 *         backend/src/vendors/middleware/rbac.ts
 *         backend/src/vendors/encryption/roleClients.ts
 *
 * PCI DSS Req 10.2.1.1/10.2.2 and EBA/GL/2019/04 §31(d): every server-side disclosure of a
 * sensitive value emits exactly one compliance event naming the affected data, never its value.
 * PCI DSS Req 7.2.2 / ISO 27001 A.8.2: the Level 2 QE client is granted by a named capability,
 * not by passing a literal role string to getDbForRole inside a service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  getDbForRole: vi.fn(),
  getSensitiveTierDb: vi.fn(),
  validateToken: vi.fn().mockReturnValue({ valid: false }),
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
  emitComplianceEvent: vi.fn(),
  dispatchProvider: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
  getSensitiveTierDb: h.getSensitiveTierDb,
}));
vi.mock('../../../../backend/src/vendors/security/escalationTokens', () => ({
  validateToken: h.validateToken,
}));
vi.mock('../../../../backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({
  appendAuditEvent: h.appendAuditEvent,
}));
vi.mock('../../../../backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitComplianceEvent: h.emitComplianceEvent,
  emitProcessEvent: vi.fn(),
}));
vi.mock('../../../../backend/src/modules/provider/services/integrationDispatch.service', () => ({
  dispatchProvider: h.dispatchProvider,
}));

import { revealKycSensitive } from '../../../../backend/src/modules/customer/services/customerAgreement.service';
import { canRevealKycSensitive, KYC_ADMIN_REVEAL_ROLES } from '../../../../backend/src/vendors/middleware/rbac';

const SENSITIVE_VALUES = {
  address: { streetAddress: '1 Calle Mayor', city: 'Madrid', postalCode: '28001', countryCode: 'ES' },
  sourceOfFunds: 'salary',
  purpose: 'daily banking',
  riskNotes: 'no adverse media',
  postal: { streetAddress: '2 Gran Via', city: 'Madrid', postalCode: '28013', countryCode: 'ES' },
};

function makeL2Db() {
  return {
    collection: vi.fn((name: string) => ({
      findOne: vi.fn(async () => (name === 'party'
        ? { partyInstanceReference: 'party-1', partyPostalAddress: SENSITIVE_VALUES.postal }
        : {
          partyInstanceReference: 'party-1',
          customerAgreementResidentialAddress: SENSITIVE_VALUES.address,
          customerAgreementSourceOfFunds: SENSITIVE_VALUES.sourceOfFunds,
          customerAgreementPurposeOfRelationship: SENSITIVE_VALUES.purpose,
          customerAgreementRiskNotes: SENSITIVE_VALUES.riskNotes,
        })),
    })),
  };
}

beforeEach(() => {
  h.emitComplianceEvent.mockReset();
  h.getSensitiveTierDb.mockReset();
  h.getSensitiveTierDb.mockResolvedValue(makeL2Db());
});

describe('canRevealKycSensitive (C6 named capability)', () => {
  it('grants the KYC administration and audit roles', () => {
    expect(KYC_ADMIN_REVEAL_ROLES.has('operations_officer' as never)).toBe(true);
    expect(KYC_ADMIN_REVEAL_ROLES.has('security_auditor')).toBe(true);
    expect(canRevealKycSensitive('operations_officer' as never)).toBe(true);
    expect(canRevealKycSensitive('security_auditor')).toBe(true);
  });

  it('grants an L2 investigator only with a valid escalation token', () => {
    expect(canRevealKycSensitive('level2_investigator', false)).toBe(false);
    expect(canRevealKycSensitive('level2_investigator', true)).toBe(true);
  });

  it('denies L1, customer, merchant officer and manager', () => {
    for (const role of ['level1_analyst', 'customer', 'merchant_officer', 'manager'] as const) {
      expect(canRevealKycSensitive(role)).toBe(false);
    }
  });
});

describe('revealKycSensitive', () => {
  it('emits exactly one compliance event naming the revealed fields', async () => {
    const res = await revealKycSensitive({} as never, 'party-1', { performedByRole: 'operations_officer' }, {
      callerRole: 'operations_officer' as never,
    });
    expect(res.status).toBe('ok');
    expect(h.emitComplianceEvent).toHaveBeenCalledTimes(1);
    const opts = h.emitComplianceEvent.mock.calls[0][1];
    expect(opts.processAction).toBe('kyc.sensitive.revealed');
    expect(opts.eventSummary.revealedFields).toEqual([
      'customerAgreementResidentialAddress',
      'customerAgreementSourceOfFunds',
      'customerAgreementPurposeOfRelationship',
      'customerAgreementRiskNotes',
      'partyPostalAddress',
    ]);
  });

  it('never puts a revealed value in the event payload', async () => {
    await revealKycSensitive({} as never, 'party-1', {}, { callerRole: 'security_auditor' });
    const serialized = JSON.stringify(h.emitComplianceEvent.mock.calls[0][1]);
    for (const value of Object.values(SENSITIVE_VALUES)) {
      const needle = typeof value === 'string' ? value : value.streetAddress;
      expect(serialized).not.toContain(needle);
    }
  });

  it('obtains the Level 2 client from the named capability, never from a role string', async () => {
    await revealKycSensitive({} as never, 'party-1', {}, { callerRole: 'operations_officer' as never });
    expect(h.getSensitiveTierDb).toHaveBeenCalledWith('canRevealKycSensitive');
    expect(h.getDbForRole).not.toHaveBeenCalled();
  });

  it('refuses a role without the capability and emits no event', async () => {
    const res = await revealKycSensitive({} as never, 'party-1', {}, { callerRole: 'level1_analyst' });
    expect(res.status).toBe('forbidden');
    expect(h.emitComplianceEvent).not.toHaveBeenCalled();
  });

  it('refuses an L2 investigator without an escalation token', async () => {
    const res = await revealKycSensitive({} as never, 'party-1', {}, {
      callerRole: 'level2_investigator', hasValidToken: false,
    });
    expect(res.status).toBe('forbidden');
  });
});

describe('no hardcoded role in sensitive-tier client selection (test 27)', () => {
  const SRC = join(process.cwd(), 'backend', 'src');
  // The escalation plumbing itself legitimately names roles; business services must not.
  const ALLOWED = new Set([
    join('vendors', 'encryption', 'roleClients.ts'),
    join('vendors', 'middleware', 'rbac.ts'),
    join('vendors', 'middleware', 'acl.ts'),
  ]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('never calls getDbForRole with a literal role string', () => {
    const offenders: string[] = [];
    // getDbForRole('<literal>' ...) — a quoted first argument is a hardcoded tier grant.
    const pattern = /getDbForRole\(\s*['"]/;
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1);
      if ([...ALLOWED].some((a) => rel.endsWith(a))) continue;
      const src = readFileSync(file, 'utf-8');
      for (const line of src.split('\n')) {
        // The demo raw-view resolver uses the L1 (lookup) client on purpose; only the
        // sensitive tier must not be self-granted. Flag any literal to keep the rule simple,
        // except an explicit level1_analyst lookup, which grants nothing extra.
        if (pattern.test(line) && !line.includes("'level1_analyst'")) offenders.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
