import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { TOKEN_COLLECTION } from '../../../shared/models/collections';
import { TokenRecord, ActorClaim } from '../models/token.model';
import { RealmRecord } from '../../realm/models/realm.model';
import { ClientRecord } from '../models/client.model';
import { JwtTokenFormat } from './jwtTokenFormat';
import { KeyRing } from '../../keys/services/keyRing.service';
import { newMeta } from '../../../shared/models/base.model';

export interface IssueTokensInput {
  realm: RealmRecord;
  client: ClientRecord;
  subjectId?: string;
  scope: string[];
  sessionId?: string;
  sessionEpoch?: number;
  /** Permissions the resource server enforces, resolved by the decision point at issuance. */
  permissions?: Array<{ resource: string; action: string }>;
  /** Delegation chain, when the token was obtained by exchange rather than issued directly. */
  actor?: ActorClaim;
  nonce?: string;
  includeRefreshToken?: boolean;
  includeIdToken?: boolean;
  /** Profile claims for the id token, so this service needs no directory read of its own. */
  idTokenClaims?: Record<string, unknown>;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  refresh_token?: string;
  id_token?: string;
}

/**
 * Mints the tokens and records what was issued.
 *
 * The record is not what a resource server checks: verification is a signature check against the
 * published key set, with no call here. What the record buys is the ability to revoke, to detect a
 * replay, and to say afterwards what was issued to whom, which a stateless design cannot do.
 */
export class TokenIssuer {
  constructor(private readonly db: Db, private readonly ring: KeyRing) {}

  private get tokens() {
    return this.db.collection<TokenRecord>(TOKEN_COLLECTION);
  }

  private ttl(realm: RealmRecord, client: ClientRecord): { access: number; refresh: number } {
    return {
      access: client.tokenPolicy?.accessTokenTtlSeconds ?? realm.tokenPolicy.accessTokenTtlSeconds,
      refresh: client.tokenPolicy?.refreshTokenTtlSeconds ?? realm.tokenPolicy.refreshTokenTtlSeconds,
    };
  }

  private async record(
    realm: RealmRecord,
    client: ClientRecord,
    input: { jti: string; type: TokenRecord['type']; subjectId?: string; scope: string; expiresAt: Date; sessionId?: string; actor?: ActorClaim },
  ): Promise<void> {
    await this.tokens.insertOne({
      realmId: realm.realmId,
      tenantId: realm.tenantId,
      tokenId: `tok-${input.jti}`,
      jti: input.jti,
      type: input.type,
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
      clientId: client.clientId,
      scope: input.scope,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      issuedAt: new Date().toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      ...(input.actor ? { actor: input.actor } : {}),
      meta: newMeta('Token'),
    } as TokenRecord);
  }

  async issue(input: IssueTokensInput): Promise<TokenResponse> {
    const { realm, client } = input;
    const ttl = this.ttl(realm, client);
    const now = Math.floor(Date.now() / 1000);
    const scope = input.scope.join(' ');

    const format = new JwtTokenFormat(this.ring, realm.realmId);
    const kid = await this.ring.signingKid(realm.realmId);

    const accessJti = uuidv4();
    const accessClaims: Record<string, unknown> = {
      iss: realm.issuer,
      // The client is the audience of its own access token. A resource server checks that it is
      // named here, which is what stops a token minted for one API opening another.
      aud: client.clientId,
      sub: input.subjectId ?? client.clientId,
      jti: accessJti,
      iat: now,
      nbf: now,
      exp: now + ttl.access,
      scope,
      client_id: client.clientId,
      ...(input.sessionId ? { sid: input.sessionId } : {}),
      // The epoch travels in the token so a resource server can refuse a whole generation at once,
      // without listing outstanding tokens.
      ...(input.sessionEpoch !== undefined ? { session_epoch: input.sessionEpoch } : {}),
      ...(input.permissions?.length ? { permissions: input.permissions } : {}),
      ...(input.actor ? { act: input.actor } : {}),
    };

    const access_token = await format.issue(accessClaims, kid);
    await this.record(realm, client, {
      jti: accessJti,
      type: 'access',
      subjectId: input.subjectId,
      scope,
      expiresAt: new Date((now + ttl.access) * 1000),
      sessionId: input.sessionId,
      actor: input.actor,
    });

    const response: TokenResponse = {
      access_token,
      token_type: 'Bearer',
      expires_in: ttl.access,
      scope,
    };

    if (input.includeRefreshToken) {
      const refreshJti = uuidv4();
      // Opaque rather than a JWT: nothing verifies a refresh token locally, it is always redeemed
      // here, so giving it a readable payload would disclose claims for no benefit at all.
      response.refresh_token = `${refreshJti}.${uuidv4().replace(/-/g, '')}`;
      await this.record(realm, client, {
        jti: refreshJti,
        type: 'refresh',
        subjectId: input.subjectId,
        scope,
        expiresAt: new Date((now + ttl.refresh) * 1000),
        sessionId: input.sessionId,
      });
    }

    if (input.includeIdToken && input.subjectId) {
      const idJti = uuidv4();
      const idFormat = new JwtTokenFormat(this.ring, realm.realmId, 'JWT');
      response.id_token = await idFormat.issue({
        iss: realm.issuer,
        aud: client.clientId,
        sub: input.subjectId,
        jti: idJti,
        iat: now,
        exp: now + ttl.access,
        ...(input.nonce ? { nonce: input.nonce } : {}),
        ...(input.idTokenClaims ?? {}),
      }, kid);
      await this.record(realm, client, {
        jti: idJti,
        type: 'id',
        subjectId: input.subjectId,
        scope,
        expiresAt: new Date((now + ttl.access) * 1000),
        sessionId: input.sessionId,
      });
    }

    return response;
  }

  /** Looks a refresh token up by the identifier embedded in its opaque form. */
  async findRefreshToken(realmId: string, presented: string): Promise<TokenRecord | null> {
    const jti = presented.split('.')[0];
    if (!jti) return null;
    return this.tokens.findOne({ realmId, jti, type: 'refresh' }, { projection: { _id: 0 } });
  }

  async findByJti(realmId: string, jti: string): Promise<TokenRecord | null> {
    return this.tokens.findOne({ realmId, jti }, { projection: { _id: 0 } });
  }

  async revoke(realmId: string, jti: string, reason: string): Promise<boolean> {
    const result = await this.tokens.updateOne(
      { realmId, jti, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date().toISOString(), revocationReason: reason } },
    );
    return result.modifiedCount > 0;
  }

  /** Revokes everything issued under a session, which is what a logout has to do. */
  async revokeSession(realmId: string, sessionId: string, reason: string): Promise<number> {
    const result = await this.tokens.updateMany(
      { realmId, sessionId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date().toISOString(), revocationReason: reason } },
    );
    return result.modifiedCount;
  }
}
