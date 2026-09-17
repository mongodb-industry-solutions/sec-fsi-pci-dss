import { FastifyRequest } from 'fastify';
import { VerifiedClaims, verifyAccessToken } from './tokenVerifier';
import { authorityMachineToken } from './machineToken';

/**
 * Which business record the caller of a token owns.
 *
 * This used to be a database lookup: take the token's subject, find the authentication record, read
 * the party reference off it. That lookup no longer exists here, and could not: this application no
 * longer holds the authentication records to look in.
 *
 * The authority carries the reference in the token instead. It never resolves the value and does not
 * know what it names; it stores the binding and hands it back, which is exactly enough for this
 * application to find its own records without either side learning the other's vocabulary.
 *
 * The consequence worth stating: a token issued before a principal was bound to a business record
 * will not carry one, and the answer is undefined rather than a stale lookup. That is the correct
 * answer, and the caller re-authenticates to get a token that has it.
 */

/** The claim the authority puts the binding in. */
const ACCOUNT_HOLDER_CLAIM = 'account_holder';

export function partyReferenceFrom(claims: Pick<VerifiedClaims, 'sub'> & Record<string, unknown>): string | undefined {
  const bound = claims[ACCOUNT_HOLDER_CLAIM];
  return typeof bound === 'string' && bound.length > 0 ? bound : undefined;
}

/** The same, for a request whose token has already been verified by the auth middleware. */
export function partyReferenceOf(request: FastifyRequest): string | undefined {
  const claims = (request as unknown as { user?: Record<string, unknown> }).user;
  return claims ? partyReferenceFrom(claims as Pick<VerifiedClaims, 'sub'> & Record<string, unknown>) : undefined;
}

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

/**
 * Resolves a subject this application did NOT receive a token for.
 *
 * The merchant flows forward a buyer's subject identifier rather than the buyer's token, so there is
 * no `account_holder` claim to read and the binding has to be asked for. It is asked for by RFC 8693
 * token exchange: this service presents its own machine token and the subject it wants to act for,
 * and gets back an ORDINARY access token, addressed to this application exactly as any other token
 * is, which it then verifies exactly as any other token and reads `account_holder` off.
 *
 * This used to be a SCIM read (`GET /scim/v2/Users/:id`), gated on a raw shared secret with no
 * permission narrower than the realm's own break-glass operator credential. The exchange above is
 * gated on `subjects:actAs`, a permission this service's own credential holds and nothing else does,
 * so the audit trail records a specific act by a specific application rather than an operator
 * override with no record of which application invoked it.
 *
 * Fails to `undefined`, never to a guess. Every caller treats an unresolved subject as "no acting
 * party", which yields an empty result rather than somebody else's records.
 */
export async function resolvePartyReference(subjectId: string): Promise<string | undefined> {
  if (!subjectId) return undefined;

  const machineToken = await authorityMachineToken();
  if (!machineToken) return undefined;

  try {
    const { config } = await import('../../config');
    const response = await fetch(`${config.giam.issuerUrl.replace(/\/+$/, '')}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: TOKEN_EXCHANGE_GRANT,
        subject_token: machineToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_subject: subjectId,
        client_id: config.giam.clientId,
        client_secret: config.giam.clientSecret ?? '',
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;

    const { access_token: exchanged } = await response.json() as { access_token?: string };
    if (!exchanged) return undefined;

    // Verified exactly as any other token this application reads, never merely decoded: the
    // exchange endpoint is reached over the same network any caller reaches it over, so trusting an
    // unverified response would make this the one claim in the application read without a signature
    // check.
    const claims = await verifyAccessToken(exchanged);
    return claims ? partyReferenceFrom(claims) : undefined;
  } catch {
    return undefined;
  }
}
