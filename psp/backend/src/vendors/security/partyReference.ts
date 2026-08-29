import { FastifyRequest } from 'fastify';
import { VerifiedClaims } from './tokenVerifier';

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

/**
 * Resolves a subject this application did NOT receive a token for.
 *
 * The merchant flows forward a buyer's subject identifier rather than the buyer's token, so there is
 * no `account_holder` claim to read and the binding has to be asked for. It is fetched from the
 * authority, which holds it, rather than from a local table, which no longer exists.
 *
 * The better design is for the merchant to forward the buyer's TOKEN, which carries the binding and
 * proves the buyer was actually present. That is a change to a published integration contract and
 * belongs in its own piece of work, so it is recorded here rather than done quietly in passing.
 *
 * Fails to `undefined`, never to a guess. Every caller treats an unresolved subject as "no acting
 * party", which yields an empty result rather than somebody else's records.
 */
export async function resolvePartyReference(subjectId: string): Promise<string | undefined> {
  const { config } = await import('../../config');
  const token = config.giam.registrationToken;
  if (!token || !subjectId) return undefined;

  try {
    const realm = config.giam.issuerUrl.replace(/\/+$/, '');
    const response = await fetch(`${realm}/scim/v2/Users/${encodeURIComponent(subjectId)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;

    const user = await response.json() as Record<string, { accountHolderRef?: string } | undefined>;
    const extension = user['urn:mongodb:params:scim:schemas:extension:principal:2.0:Principal'];
    return extension?.accountHolderRef;
  } catch {
    return undefined;
  }
}
