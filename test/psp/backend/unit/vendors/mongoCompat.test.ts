import { describe, it, expect } from 'vitest';
import {
  parseVersion, atLeast, compareVersions, parseDeploymentType, declaredDeployment,
  resolveQeProfile, capabilitiesOf, classifyProbe, isUnsupportedQueryTypeError,
  versionMismatch, describeTarget, describeDeployment, encryptedFieldsDrift,
} from '@ist-sec/mongo-compat';

// @ist-sec/mongo-compat is shared verbatim by PSP, bankcore and GIAM (vendored, no registry), so
// its pure functions are tested once here rather than once per consumer.

describe('mongo-compat: version parsing', () => {
  it('parses major.minor.patch and tolerates build suffixes', () => {
    expect(parseVersion('9.0.2')).toEqual({ major: 9, minor: 0, patch: 2, raw: '9.0.2' });
    expect(parseVersion('9.0.0-rc0')).toEqual({ major: 9, minor: 0, patch: 0, raw: '9.0.0-rc0' });
    expect(parseVersion('8.2')).toEqual({ major: 8, minor: 2, patch: 0, raw: '8.2' });
  });

  it('atLeast compares major.minor only, patch never gates', () => {
    expect(atLeast(parseVersion('9.0.0'), 9, 0)).toBe(true);
    expect(atLeast(parseVersion('8.2.9'), 9, 0)).toBe(false);
    expect(atLeast(parseVersion('8.3.0'), 8, 2)).toBe(true);
  });

  it('compareVersions ignores -rc suffixes', () => {
    expect(compareVersions('9.0.0-rc0', '9.0.0')).toBe(0);
    expect(compareVersions('8.2.4', '9.0.0')).toBeLessThan(0);
  });
});

describe('mongo-compat: deployment type parsing', () => {
  it('recognizes ce/community, ea/enterprise, and defaults to atlas', () => {
    expect(parseDeploymentType('ce')).toBe('ce');
    expect(parseDeploymentType('Community')).toBe('ce');
    expect(parseDeploymentType('ea')).toBe('ea');
    expect(parseDeploymentType('Enterprise')).toBe('ea');
    expect(parseDeploymentType('atlas')).toBe('atlas');
    expect(parseDeploymentType(undefined)).toBe('atlas');
    expect(parseDeploymentType('typo')).toBe('atlas');
  });
});

describe('mongo-compat: QE text-search profile table', () => {
  it('below 8.2 has no text search and forces equality', () => {
    const profile = resolveQeProfile('8.1.9');
    expect(profile.textSearch).toBe(false);
    expect(profile.substring).toBe('equality');
  });

  it('8.2-8.3 uses the Preview names with strMaxQueryLength 10', () => {
    const profile = resolveQeProfile('8.3.11');
    expect(profile.textSearch).toBe(true);
    expect(profile.substring).toBe('substringPreview');
    expect(profile.prefix).toBe('prefixPreview');
    expect(profile.suffix).toBe('suffixPreview');
    expect(profile.substringMaxQueryLength).toBe(10);
  });

  it('9.0+ uses the GA names with strMaxQueryLength 6', () => {
    const profile = resolveQeProfile('9.0.2');
    expect(profile.substring).toBe('substring');
    expect(profile.prefix).toBe('prefix');
    expect(profile.suffix).toBe('suffix');
    expect(profile.substringMaxQueryLength).toBe(6);
  });

  it('a version newer than every band uses the newest band rather than failing', () => {
    expect(resolveQeProfile('10.4.0').substring).toBe('substring');
  });
});

describe('mongo-compat: capability derivation', () => {
  it('gates automatic encryption off for Community even when the version supports QE', () => {
    const deployment = declaredDeployment('ce', '9.0.2');
    const caps = capabilitiesOf(deployment);
    expect(caps.queryableEncryption).toBe(true);
    expect(caps.automaticEncryption).toBe(false);
    expect(caps.qeTextSearchProfile.textSearch).toBe(false); // the 0.0.0 fallback profile
    expect(caps.serverAuditLog).toBe(false);
    expect(caps.supportsAtlasAdminApi).toBe(false);
  });

  it('gates range queries to 8.0+ and text search to 8.2+ on Atlas/EA', () => {
    expect(capabilitiesOf(declaredDeployment('atlas', '7.0.0')).qeRange).toBe(false);
    expect(capabilitiesOf(declaredDeployment('atlas', '8.0.0')).qeRange).toBe(true);
    expect(capabilitiesOf(declaredDeployment('ea', '8.2.0')).qeTextSearchProfile.textSearch).toBe(true);
  });

  it('change streams and transactions follow replicaSet, not version', () => {
    const standalone = { ...declaredDeployment('ea', '9.0.0'), replicaSet: false };
    expect(capabilitiesOf(standalone).changeStreams).toBe(false);
    expect(capabilitiesOf(standalone).transactions).toBe(false);
  });

  it('atlasSearch is Atlas-only', () => {
    expect(capabilitiesOf(declaredDeployment('atlas', '9.0.0')).atlasSearch).toBe(true);
    expect(capabilitiesOf(declaredDeployment('ea', '9.0.0')).atlasSearch).toBe(false);
  });
});

describe('mongo-compat: live probe classification', () => {
  it('classifies Atlas from atlasVersion or a .mongodb.net host', () => {
    const byField = classifyProbe({ version: '9.0.2', atlasVersion: 'x' }, {}, 'mongodb://localhost');
    expect(byField.type).toBe('atlas');
    const byHost = classifyProbe({ version: '9.0.2' }, {}, 'mongodb+srv://cluster0.abcde.mongodb.net');
    expect(byHost.type).toBe('atlas');
  });

  it('classifies Enterprise Advanced from the enterprise module, Community otherwise', () => {
    expect(classifyProbe({ version: '9.0.2', modules: ['enterprise'] }, {}, 'mongodb://localhost').type).toBe('ea');
    expect(classifyProbe({ version: '9.0.2', modules: [] }, {}, 'mongodb://localhost').type).toBe('ce');
  });

  it('a replica set name or isdbgrid (mongos) both count as a replica set', () => {
    expect(classifyProbe({ version: '9.0.2' }, { setName: 'rs0' }, '').replicaSet).toBe(true);
    expect(classifyProbe({ version: '9.0.2' }, { msg: 'isdbgrid' }, '').replicaSet).toBe(true);
    expect(classifyProbe({ version: '9.0.2' }, {}, '').replicaSet).toBe(false);
  });
});

describe('mongo-compat: unsupported query type detection', () => {
  it('matches driver messages naming an unknown query type', () => {
    expect(isUnsupportedQueryTypeError("Enumeration value 'suffix' ... is not a valid value")).toBe(true);
    expect(isUnsupportedQueryTypeError('this queryType is deprecated')).toBe(true);
    expect(isUnsupportedQueryTypeError('connection refused')).toBe(false);
  });
});

describe('mongo-compat: cross-check and reporting helpers', () => {
  it('versionMismatch is null within a profile band, set across one', () => {
    expect(versionMismatch('9.0.0', '9.0.2')).toBeNull();
    expect(versionMismatch('8.2.4', '9.0.1')).not.toBeNull();
  });

  it('describeTarget labels each edition in full', () => {
    expect(describeTarget('atlas', '9.0.0')).toContain('Atlas');
    expect(describeTarget('ea', '9.0.0')).toContain('Enterprise Advanced');
    expect(describeTarget('ce', '9.0.0')).toContain('Community');
  });

  it('describeDeployment reports topology and source', () => {
    const d = { ...declaredDeployment('atlas', '9.0.2'), source: 'detected' as const };
    expect(describeDeployment(d)).toBe('atlas 9.0.2 (replica set, detected)');
  });

  it('encryptedFieldsDrift flags only fields that exist with a different query type', () => {
    const expected = [{ path: 'party.partyName', queryType: 'substring' }];
    expect(encryptedFieldsDrift(expected, [{ path: 'party.partyName', queryType: 'substringPreview' }])).toContain('partyName');
    expect(encryptedFieldsDrift(expected, [])).toBeNull(); // not created yet: reported elsewhere
    expect(encryptedFieldsDrift(expected, [{ path: 'party.partyName', queryType: 'substring' }])).toBeNull();
  });
});
