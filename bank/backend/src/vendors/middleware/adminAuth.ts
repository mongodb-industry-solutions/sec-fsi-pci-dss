import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyRealmToken } from '../security/tokenVerifier';

/**
 * The diagnostics surface guard.
 *
 * Diagnostics are protected even though the Open Banking surface is deliberately reachable: this
 * service has a public hostname so its API can be reviewed and tested, and a log buffer is not
 * something to publish.
 *
 * It used to verify a JWT the payment service issued, with a secret the two shared. That is gone in
 * both halves: no application here issues tokens any more, and a shared symmetric secret between two
 * services means either of them can mint a token the other accepts. The token is now verified
 * against the authority's published key set, like every other token this service sees, and the
 * authority holds the only private key.
 *
 * The Open Banking endpoints authenticate differently, with third-party client credentials. That is
 * a different mechanism for a different audience and the two must never substitute for each other.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(request.headers.authorization ?? '');
  if (!match) {
    return reply.status(401).send({ error: 'Missing admin token' }) as never;
  }

  const claims = await verifyRealmToken(match[1]);
  if (!claims) {
    return reply.status(401).send({ error: 'Invalid admin token' }) as never;
  }

  // The role travels as a claim the authority resolved, rather than being asserted by the token
  // holder. A role this service read out of an unverified token would be a role anyone could claim.
  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  if (!roles.includes('admin') && !roles.includes('bank_admin')) {
    return reply.status(403).send({ error: 'Admin role required' }) as never;
  }
}
