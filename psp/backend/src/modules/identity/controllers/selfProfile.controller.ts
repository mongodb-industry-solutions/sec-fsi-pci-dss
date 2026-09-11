import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSelfProfile, updateSelfProfile } from '../../customer/services/customerAgreement.service';
import { PARTY_COLLECTION, PartyControlRecord } from '../../customer/models/party.model';
import { partyReferenceOf } from '../../../vendors/security/partyReference';
import { callAuthority } from '../../../vendors/security/authorityApi';

/**
 * A person's own profile: who the authority says they are, plus this product's record of them.
 *
 * Restored after the identity extraction deleted it. The route went with the authentication
 * implementation it used to live beside, and the console kept calling it, so `/system/profile`
 * rendered nothing at all: `api.auth.me` answered 404, the page swallowed that into a null result
 * and returned no markup. The screen was blank rather than broken-looking, which is why it survived
 * a green test suite.
 *
 * It belongs HERE and not at the authority. The identity half is read from the authority's
 * `userinfo`; what this route adds is the customer agreement and the party record, which are this
 * product's data and which the authority neither holds nor should.
 *
 * The one thing that genuinely changed is how the business record is found. It used to be a lookup
 * through an authentication record this application no longer holds; now the authority carries the
 * binding as a claim, so this reads a claim. A token issued before a principal was bound carries
 * none, and the honest answer is an empty profile rather than a guess.
 */
export async function selfProfileController(fastify: FastifyInstance) {
  /** The verified claims the auth middleware attached. */
  function callerOf(request: FastifyRequest): Record<string, unknown> | undefined {
    return (request as unknown as { user?: Record<string, unknown> }).user;
  }

  function stringClaim(claims: Record<string, unknown>, name: string): string | undefined {
    const value = claims[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  /**
   * The single role the screens are built around, from the `roles` array the authority issues.
   *
   * Collapsed the same way the console collapses it. Empty rather than undefined when the claim is
   * missing, so a screen reading it renders nothing rather than throwing.
   */
  function primaryRole(claims: Record<string, unknown>): string {
    const roles = Array.isArray(claims.roles) ? claims.roles.map(String) : [];
    return roles[0] ?? '';
  }

  /**
   * Who the caller is, asked of the authority rather than read off the access token.
   *
   * The access token does NOT carry `email` or `name`, and it is right not to: those are profile
   * claims, and RFC 9068 keeps them out of an access token, which is addressed to a resource server
   * and not to whoever is being described. `userinfo` is where OIDC puts them, and the caller's own
   * token is what authorises the question.
   *
   * This is the correction that mattered on restoring the route: reading `user.email` was how it
   * worked when this application minted its own tokens, and carrying that assumption over would
   * have refused every caller with a 401 that named the wrong problem.
   */
  async function identityOf(request: FastifyRequest): Promise<{ email?: string; name?: string }> {
    try {
      return await callAuthority<{ email?: string; name?: string }>(
        request,
        '/protocol/openid-connect/userinfo',
      );
    } catch {
      // An unreachable authority must not empty a profile. The caller is still authenticated, the
      // token was already verified, and the business half below does not depend on this.
      return {};
    }
  }

  fastify.get('/me', {
    schema: {
      tags: ['auth'],
      summary: 'Get my own profile',
      description:
        'The caller\'s identity, as carried by the verified token, together with this product\'s '
        + 'own records for them: the customer agreement and the party record. A caller with no '
        + 'business record, which is every staff role, gets the identity half and nulls for the '
        + 'rest rather than an error.',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            sub: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
            domain: { type: 'string' },
            partyInstanceReference: { type: 'string', nullable: true },
            party: { type: 'object', nullable: true, additionalProperties: true },
            agreement: { type: 'object', nullable: true, additionalProperties: true },
          },
        },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const caller = callerOf(request);
    if (!caller) return reply.status(401).send({ error: 'Unauthenticated' });

    const identity = await identityOf(request);
    const email = identity.email ?? '';

    /**
     * Attempted for everybody, not gated on the role being `customer`.
     *
     * The lookup is by the caller's own email and returns null when there is no such record, so a
     * staff caller is answered correctly without this route having to interpret a role string. One
     * fewer place where a renamed role would silently empty a screen.
     */
    const agreement = email ? await getSelfProfile(fastify.db, email).catch(() => null) : null;

    // The claim is the fallback: an agreement names its own party, and a staff caller has no
    // agreement to name one.
    const partyInstanceReference =
      (agreement?.partyInstanceReference as string | undefined) ?? partyReferenceOf(request);

    let party: Record<string, unknown> | null = null;
    if (partyInstanceReference) {
      party = await fastify.db
        .collection<PartyControlRecord>(PARTY_COLLECTION)
        /**
         * `__safeContent__` is excluded, not merely untidy.
         *
         * It is Queryable Encryption's own index material, the HMAC tags the server matches
         * encrypted queries against. It decrypts to nothing a caller can use and it is not ours to
         * publish: shipping it to a browser hands out the searchable tokens for a collection that
         * holds identity documents, and it is per document, so it grows the payload with material
         * no screen reads.
         */
        .findOne({ partyInstanceReference }, { projection: { _id: 0, __safeContent__: 0 } })
        .catch(() => null) as Record<string, unknown> | null;
    }

    return reply.send({
      sub: stringClaim(caller, 'sub') ?? '',
      email,
      name: identity.name ?? '',
      role: primaryRole(caller),
      domain: stringClaim(caller, 'domain') ?? 'giam',
      partyInstanceReference: partyInstanceReference ?? null,
      party,
      agreement,
    });
  });

  fastify.patch('/me', {
    schema: {
      tags: ['auth'],
      summary: 'Update my own profile',
      description:
        'The fields a person may change about themselves. A password is NOT among them: it is held '
        + 'by the identity authority and changed on its own credentials page, which is the only '
        + 'place one is ever entered.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          customerName: { type: 'string' },
          customerMobilePhoneNumber: { type: 'string' },
          customerAgreementPreferredLanguage: { type: 'string' },
          customerAgreementResidentialAddress: {
            type: 'object',
            additionalProperties: false,
            required: ['streetAddress', 'city', 'postalCode', 'countryCode'],
            properties: {
              streetAddress: { type: 'string' },
              city: { type: 'string' },
              postalCode: { type: 'string' },
              countryCode: { type: 'string' },
            },
          },
        },
      },
      response: {
        200: { type: 'object', properties: { updated: { type: 'boolean' } } },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const caller = callerOf(request);
    if (!caller) return reply.status(401).send({ error: 'Unauthenticated' });

    const { email } = await identityOf(request);
    // Without an email there is no record to address, and guessing one would edit somebody else's.
    if (!email) return reply.status(404).send({ error: 'No profile record for this user' });

    const updated = await updateSelfProfile(
      fastify.db,
      email,
      request.body as Parameters<typeof updateSelfProfile>[2],
    );
    // No record to change is a 404 and not a silent success: a caller told "updated" about a write
    // that did not happen would show the new value until the next reload contradicted it.
    if (!updated) return reply.status(404).send({ error: 'No profile record for this user' });
    return reply.send({ updated: true });
  });
}
