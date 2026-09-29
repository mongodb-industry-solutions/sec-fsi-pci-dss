/**
 * What a given MongoDB accepts for Queryable Encryption, by version range.
 *
 * The text-search query types are named differently across versions and the spellings are mutually
 * exclusive: `substringPreview` / `prefixPreview` / `suffixPreview` up to 9.0, `substring` /
 * `prefix` / `suffix` from 9.0 on. A 9.0 server refuses the preview names at creation and at query
 * time, and that refusal breaks EVERY encrypted query on the collection, not only the text ones.
 * An 8.x crypt_shared, conversely, does not know the GA names. So the deployment declares which
 * MongoDB it targets and this table decides how to build the encrypted fields map.
 *
 * Pure on purpose (no config, no driver): every app reads it to derive its own defaults, and the
 * setup, validation and runtime paths all check against the same table.
 */

/** Deployment kind. Only Atlas exposes the Admin API that provisions custom roles and DB users. */
export type MongoDeploymentType = 'atlas' | 'ea';

export interface QeProfile {
  /** Human label for logs and setup output. */
  label: string;
  /** Whether this version supports QE text search at all. */
  textSearch: boolean;
  substring: string;
  prefix: string;
  suffix: string;
  /** Largest strMaxQueryLength the server accepts for substring without a parameter-limit override. */
  substringMaxQueryLength: number;
  /** crypt_shared series that matches this server, stated in warnings. */
  cryptShared: string;
}

/** Numeric comparison of dotted versions; missing segments count as 0, suffixes like -rc0 ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('-')[0].split('.').map((p) => parseInt(p, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Version ranges, oldest first. `from` is inclusive, the next entry's `from` is the exclusive
 * upper bound. A version newer than every entry uses the last one (the newest known behaviour)
 * rather than failing, so a server upgrade does not take the demo down; setup warns instead.
 */
const PROFILES: { from: string; profile: QeProfile }[] = [
  {
    from: '0.0.0',
    profile: {
      label: 'pre-8.2 (no QE text search)',
      textSearch: false,
      substring: 'equality', prefix: 'equality', suffix: 'equality',
      substringMaxQueryLength: 0,
      cryptShared: 'any',
    },
  },
  {
    from: '8.2.0',
    profile: {
      label: '8.2-8.3 (preview query types)',
      textSearch: true,
      substring: 'substringPreview', prefix: 'prefixPreview', suffix: 'suffixPreview',
      substringMaxQueryLength: 10,
      cryptShared: '8.2.x-8.3.x',
    },
  },
  {
    from: '9.0.0',
    profile: {
      label: '9.0+ (GA query types)',
      textSearch: true,
      substring: 'substring', prefix: 'prefix', suffix: 'suffix',
      // Server 9.0 rejects anything above 6 here (error 12860002).
      substringMaxQueryLength: 6,
      cryptShared: '9.0.x',
    },
  },
];

/** The profile for a declared server version. */
export function resolveQeProfile(version: string): QeProfile {
  let match = PROFILES[0].profile;
  for (const entry of PROFILES) {
    if (compareVersions(version, entry.from) >= 0) match = entry.profile;
  }
  return match;
}

/** True when the Atlas Admin API is available to provision custom roles and DB users. */
export function supportsAtlasAdminApi(type: MongoDeploymentType): boolean {
  return type === 'atlas';
}

/**
 * Compares the declared version with the one the cluster reports. A mismatch across a profile
 * boundary picks the wrong query type names for the whole database, and surfaces later as an
 * unrelated 500, so it is reported at setup time.
 */
export function versionMismatch(declared: string, actual: string): string | null {
  const a = resolveQeProfile(declared);
  const b = resolveQeProfile(actual);
  if (a === b) return null;
  return `MONGODB_VERSION declares ${declared} (${a.label}) but the cluster reports ${actual} `
    + `(${b.label}). Set MONGODB_VERSION=${actual} and use a crypt_shared ${b.cryptShared} library.`;
}


/** One-line description of the declared target, for setup and startup logs. */
export function describeTarget(type: MongoDeploymentType, version: string): string {
  const profile = resolveQeProfile(version);
  return `${type === 'atlas' ? 'Atlas' : 'Enterprise Advanced'} ${version}, QE ${profile.label}`;
}

export interface EncryptedFieldQuery {
  /** `collection.path` of the encrypted field. */
  path: string;
  /** Declared query type, or 'none' for a field that is encrypted but not searchable. */
  queryType: string;
}

/**
 * Compares the encrypted fields a deployment declares with the ones actually stored in the
 * database. A collection created under a different query type keeps refusing every encrypted
 * query on it, not only the text ones, and nothing short of recreating it repairs that, so the
 * difference is named field by field.
 */
export function encryptedFieldsDrift(
  expected: EncryptedFieldQuery[],
  stored: EncryptedFieldQuery[],
): string | null {
  const storedByPath = new Map(stored.map((f) => [f.path, f.queryType]));
  const differences: string[] = [];
  for (const field of expected) {
    const actual = storedByPath.get(field.path);
    if (actual === undefined) continue;               // collection not created yet: reported elsewhere
    if (actual !== field.queryType) differences.push(`${field.path}: stored ${actual}, expected ${field.queryType}`);
  }
  if (differences.length === 0) return null;
  return `${differences.length} encrypted field(s) differ from the declared configuration `
    + `(${differences.join('; ')}). Recreate them: setup:db:drop then setup:db.`;
}

/**
 * Best-effort check of the crypt_shared library actually configured. The path is the only version
 * information available before the driver fails, and pointing at the wrong series is the most
 * common way to break this, so a naming hint is worth a warning (never an error).
 */
export function cryptSharedHint(version: string, libPath: string): string | null {
  const found = /(\d+)\.(\d+)\.\d+/.exec(libPath);
  if (!found) return null;
  const libSeries = `${found[1]}.${found[2]}`;
  const profile = resolveQeProfile(version);
  const wanted = profile.cryptShared;
  if (wanted === 'any' || wanted.includes(libSeries)) return null;
  return `MONGODB_CRYPT_SHARED_LIB_PATH looks like crypt_shared ${libSeries}, but a server ${version} `
    + `deployment needs ${wanted}. Text-search fields will be refused if this is wrong.`;
}
