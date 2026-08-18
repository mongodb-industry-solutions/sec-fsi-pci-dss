import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../../vendors/middleware/adminAuth';
import {
  BANK_CAPABILITY_KEYS, BankCapabilityKey,
} from '../models/bankModuleConfiguration.model';
import {
  listModuleConfigurations, findModuleConfiguration, updateModuleConfiguration, isBankCapability,
} from '../services/bankModuleConfiguration.service';
import { TPP_REGISTRATION_COLLECTION, TppRegistrationControlRecord, TppRegistrationStatus } from '../../tpp-trust/models/tppRegistration.model';
import { hashClientSecret } from '../../tpp-trust/services/tppRegistration.service';
import { BANK_CONSENT_AGREEMENT_COLLECTION, BankConsentAgreementControlRecord, ConsentStatus } from '../../consent/models/bankConsent.model';
import { changeConsentStatus, findConsentByReference } from '../../consent/services/consent.service';
import {
  TPP_EVENT_SUBSCRIPTION_COLLECTION, TPP_WEBHOOK_DELIVERY_LOG_COLLECTION,
  TppEventSubscriptionControlRecord, TppWebhookDeliveryLogRecord,
} from '../../tpp-trust/models/tppEventSubscription.model';

// Administration of the bank's own internals: engine configuration, TPP registrations, consent status.
//
// **Deliberately not Open Banking, and at a different path for that reason.** No standard covers
// "configure the card simulator" or "suspend a TPP", so forcing these into `/v1` would put non-standard
// routes on the surface a TPP integrates against. They are plain REST under `/api/v1/admin`, which is
// also what the coverage gate expects.
//
// The browser never calls this directly: the PSP admin panel calls the PSP, which dispatches here, so
// there is one origin and one token in the browser (the CORS boundary this design keeps closed).
const ERROR = { type: 'object', additionalProperties: true, properties: { error: { type: 'string' } } } as const;

const CONFIG_RECORD = {
  type: 'object',
  additionalProperties: true,
  properties: {
    bankModuleCapability: { type: 'string' },
    bankModuleDescription: { type: 'string' },
    bankModuleConfiguration: { type: 'object', additionalProperties: true },
    bankModuleConfigurationStatus: { type: 'string' },
    bankModuleConfigurationConsumed: { type: 'boolean' },
    bankModuleConfigurationUpdatedBy: { type: 'string' },
    recordUpdatedDateTime: { type: 'string' },
  },
} as const;

// A registration never leaves here with its secret hash: an admin surface has no reason to disclose a
// verifier, and a leaked bcrypt hash is an offline attack on the credential.
function publicRegistration(record: TppRegistrationControlRecord) {
  const { tppRegistrationClientSecretHash, ...safe } = record;
  void tppRegistrationClientSecretHash;
  return { ...safe, tppRegistrationClientSecretConfigured: Boolean(tppRegistrationClientSecretHash) };
}

const TERMINAL_BY_BANK: ConsentStatus[] = ['valid', 'rejected', 'revokedByPsu'];

export async function bankAdminController(fastify: FastifyInstance) {
  // ── Engine configuration ─────────────────────────────────────────────────────────────────────
  fastify.get('/module/config', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'List the configuration of every bank engine',
      description:
        'One document per engine the bank owns. `bankModuleConfigurationConsumed` says whether an engine '
        + 'in this bank already reads it: a capability whose engine has not moved here yet has its '
        + 'configuration surface ready and says so, rather than looking like a setting that does nothing.',
      security: [{ adminAuth: [] }],
      response: {
        200: { type: 'object', properties: { results: { type: 'array', items: CONFIG_RECORD } } },
        401: ERROR,
        403: ERROR,
      },
    },
  }, async () => ({ results: await listModuleConfigurations(fastify.db) }));

  fastify.get('/module/config/:capability', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Read the configuration of one bank engine',
      description: `Capabilities: ${BANK_CAPABILITY_KEYS.join(', ')}.`,
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['capability'], properties: { capability: { type: 'string' } } },
      response: { 200: CONFIG_RECORD, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { capability } = request.params as { capability: string };
    if (!isBankCapability(capability)) return reply.status(404).send({ error: 'No such capability' });
    const record = await findModuleConfiguration(fastify.db, capability);
    if (!record) return reply.status(404).send({ error: 'No configuration record for this capability' });
    return record;
  });

  fastify.put('/module/config/:capability', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Replace the configuration of one bank engine',
      description:
        'Replaces the configuration document, and takes effect on the next invocation: engines resolve '
        + 'their settings per call rather than caching them at boot, so a change needs no restart.\n\n'
        + 'REPLACES rather than patches, because an operator editing a rule set has to be able to remove '
        + 'an entry, and a merge cannot express that. Keys the engine does not know are ignored when it '
        + 'resolves its configuration: an unknown option that silently does nothing is worse than one that '
        + 'was never accepted.\n\n'
        + 'This is the surface every option that used to live on a PSP provider record moves to, so a '
        + 'setting such as the card issuer\'s accepted CVV stays configurable and never becomes a constant '
        + 'in code.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['capability'], properties: { capability: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['configuration'],
        properties: {
          configuration: { type: 'object', additionalProperties: true },
          updatedBy: { type: 'string' },
        },
      },
      response: { 200: CONFIG_RECORD, 400: ERROR, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { capability } = request.params as { capability: string };
    if (!isBankCapability(capability)) return reply.status(404).send({ error: 'No such capability' });
    const body = request.body as { configuration: Record<string, unknown>; updatedBy?: string };
    const result = await updateModuleConfiguration(
      fastify.db, capability as BankCapabilityKey, body.configuration, body.updatedBy,
    );
    if (!result.ok) return reply.status(400).send({ error: result.text });
    return result.record;
  });

  // ── TPP registrations ────────────────────────────────────────────────────────────────────────
  fastify.get('/tpp/registrations', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'List the registered third parties',
      description:
        'Being registered and active is what authorises a TPP to operate this bank\'s accounts, so this is '
        + 'the record that grants access. The secret hash is never returned: an admin surface has no reason '
        + 'to disclose a verifier, and a leaked hash is an offline attack on the credential.',
      security: [{ adminAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: { results: { type: 'array', items: { type: 'object', additionalProperties: true } } },
        },
        401: ERROR,
        403: ERROR,
      },
    },
  }, async () => {
    const records = await fastify.db.collection<TppRegistrationControlRecord>(TPP_REGISTRATION_COLLECTION)
      .find({}, { projection: { _id: 0 } }).sort({ tppRegistrationClientId: 1 }).toArray();
    return { results: records.map(publicRegistration) };
  });

  fastify.patch('/tpp/registrations/:reference/status', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Suspend, revoke or reactivate a registered third party',
      description:
        'Takes effect on the next token request AND on the next call: the status is checked when a token is '
        + 'issued, so a suspended TPP stops being able to obtain one, and its already-issued tokens expire '
        + 'within their short lifetime.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['reference'], properties: { reference: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['active', 'suspended', 'revoked'] } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 400: ERROR, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const { status } = request.body as { status: TppRegistrationStatus };
    const collection = fastify.db.collection<TppRegistrationControlRecord>(TPP_REGISTRATION_COLLECTION);
    const existing = await collection.findOne({ tppRegistrationInstanceReference: reference });
    if (!existing) return reply.status(404).send({ error: 'No such TPP registration' });
    await collection.updateOne(
      { tppRegistrationInstanceReference: reference },
      { $set: { tppRegistrationStatus: status, recordUpdatedDateTime: new Date().toISOString() } },
    );
    const updated = await collection.findOne({ tppRegistrationInstanceReference: reference }, { projection: { _id: 0 } });
    return publicRegistration(updated!);
  });

  fastify.post('/tpp/registrations/:reference/secret/rotate', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Rotate the client secret of a registered third party',
      description:
        'Rotation is an operation on the record, not a redeploy. The new secret is returned ONCE and only '
        + 'its bcrypt hash is stored, so this response is the only chance to capture it: the bank verifies '
        + 'credentials and cannot disclose them afterwards.\n\n'
        + 'The caller may supply the new secret, which is what makes a coordinated rotation possible (the '
        + 'TPP is configured with it first, then the bank accepts it); omitting it has the bank generate one.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['reference'], properties: { reference: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { clientSecret: { type: 'string', minLength: 16, description: 'Optional. Generated when absent.' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            tppRegistrationClientId: { type: 'string' },
            clientSecret: { type: 'string', description: 'Returned once. Never retrievable again.' },
          },
        },
        400: ERROR,
        401: ERROR,
        403: ERROR,
        404: ERROR,
      },
    },
  }, async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const body = (request.body ?? {}) as { clientSecret?: string };
    const collection = fastify.db.collection<TppRegistrationControlRecord>(TPP_REGISTRATION_COLLECTION);
    const existing = await collection.findOne({ tppRegistrationInstanceReference: reference });
    if (!existing) return reply.status(404).send({ error: 'No such TPP registration' });

    // A generated secret is 32 random bytes, url-safe: long enough that it is not the weak link.
    const { randomBytes } = await import('crypto');
    const clientSecret = body.clientSecret ?? randomBytes(32).toString('base64url');
    await collection.updateOne(
      { tppRegistrationInstanceReference: reference },
      {
        $set: {
          tppRegistrationClientSecretHash: await hashClientSecret(clientSecret),
          recordUpdatedDateTime: new Date().toISOString(),
        },
      },
    );
    return { tppRegistrationClientId: existing.tppRegistrationClientId, clientSecret };
  });

  // ── Notification subscriptions and the delivery inspector ────────────────────────────────────
  fastify.get('/tpp/subscriptions', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'List the notification subscriptions',
      description:
        'Where the bank delivers, which events it sends, how it signs them and its retry policy. A '
        + 'subscription that omits an event type silently stops delivering it, which is why the event list '
        + 'is worth being able to read.',
      security: [{ adminAuth: [] }],
      response: {
        200: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
        401: ERROR,
        403: ERROR,
      },
    },
  }, async () => ({
    results: await fastify.db.collection<TppEventSubscriptionControlRecord>(TPP_EVENT_SUBSCRIPTION_COLLECTION)
      .find({}, { projection: { _id: 0 } }).toArray(),
  }));

  fastify.get('/tpp/deliveries', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Inspect notification deliveries',
      description:
        'One row per ATTEMPT, newest first, so a retry that eventually succeeded is distinguishable from a '
        + 'first-time success. Filter by outcome to see only what failed, or by subject to follow one '
        + 'consent or payment.\n\n'
        + 'This exists because a notification that silently never arrived is the failure mode that leaves a '
        + 'transfer stuck in `pending` with nothing to look at.',
      security: [{ adminAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          outcome: { type: 'string', description: 'delivered, failed or skipped.' },
          subject: { type: 'string', description: 'The consent or payment reference the event was about.' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      response: {
        200: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
        401: ERROR,
        403: ERROR,
      },
    },
  }, async (request) => {
    const { outcome, subject, limit } = request.query as { outcome?: string; subject?: string; limit?: number };
    const filter: Record<string, unknown> = {};
    if (outcome) filter.deliveryOutcome = outcome;
    if (subject) filter.tppEventSubjectReference = subject;
    const results = await fastify.db.collection<TppWebhookDeliveryLogRecord>(TPP_WEBHOOK_DELIVERY_LOG_COLLECTION)
      .find(filter, { projection: { _id: 0 } })
      .sort({ recordCreatedDateTime: -1 })
      .limit(limit ?? 50)
      .toArray();
    return { results };
  });

  // ── Consent administration (the manual authorisation path) ───────────────────────────────────
  fastify.get('/consents', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'List consents, newest first',
      description:
        'The bank\'s own view of the consents it holds, which is what an operator needs in `manual` mode: '
        + 'a consent sitting at `received` is one waiting for a decision.',
      security: [{ adminAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by consentStatus.' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      response: {
        200: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
        401: ERROR,
        403: ERROR,
      },
    },
  }, async (request) => {
    const { status, limit } = request.query as { status?: string; limit?: number };
    const results = await fastify.db.collection<BankConsentAgreementControlRecord>(BANK_CONSENT_AGREEMENT_COLLECTION)
      .find(status ? { bankConsentStatus: status as ConsentStatus } : {}, { projection: { _id: 0 } })
      .sort({ recordCreatedDateTime: -1 })
      .limit(limit ?? 50)
      .toArray();
    return { results };
  });

  fastify.patch('/consents/:consentId/status', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Authorise, reject or revoke a consent from the bank side',
      description:
        'This is the bank\'s half of the authorisation model. In `manual` consent mode a new consent lands '
        + '`received` and an operator moves it to `valid` or `rejected` here; `revokedByPsu` is how a '
        + 'revocation by the account holder is recorded.\n\n'
        + 'Only those three are accepted: `expired` is reached by time and `terminatedByTpp` by the TPP\'s '
        + 'own request, so setting either here would fake an event that did not happen. The change records '
        + 'its reason and lands in the consent access log, so the history stays readable.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['consentId'], properties: { consentId: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: TERMINAL_BY_BANK },
          reason: { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 400: ERROR, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { consentId } = request.params as { consentId: string };
    const { status, reason } = request.body as { status: ConsentStatus; reason?: string };
    if (!TERMINAL_BY_BANK.includes(status)) {
      return reply.status(400).send({ error: `the bank can set only: ${TERMINAL_BY_BANK.join(', ')}` });
    }
    const existing = await findConsentByReference(fastify.db, consentId);
    if (!existing) return reply.status(404).send({ error: 'No such consent' });

    const updated = await changeConsentStatus(
      fastify.db, consentId, status, reason ?? `set_by_bank_operator_to_${status}`,
    );
    return updated ?? existing;
  });
}
