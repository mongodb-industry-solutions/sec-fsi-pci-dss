// The headers Berlin Group defines on the XS2A interface, described ONCE.
//
// Four controllers had their own copy of this and two more had none at all, which is why the published
// specification told a third party that `X-Request-ID` exists on an account read and said nothing about it on
// a consent or a standing order. The header worked on all of them: it is handled by a plugin on every request,
// echoed on the response and stamped on every record written. It was the DOCUMENTATION that was partial, and an
// endpoint whose headers are undocumented is one a caller has to discover by experiment.
//
// Two shapes rather than one, because the two audiences differ. An AIS or PIS call is made under a consent and
// must carry `Consent-ID`; creating that consent obviously cannot, and neither can obtaining a token.

const REQUEST_ID = {
  type: 'string',
  description:
    'Caller correlation id (Berlin Group). Echoed on the response and stamped on every record this call '
    + 'writes, so one payment is traceable by the same id in either service. Generated when absent rather '
    + 'than refused, which is a documented deviation from the standard making it mandatory.',
} as const;

const CONSENT_ID = {
  type: 'string',
  description:
    'The consent that authorises this access (Berlin Group). Refused when absent, when the consent is not '
    + '`valid`, or when it does not cover what was asked for.',
} as const;

/**
 * For every call made UNDER a consent: account information, payment initiation, funds confirmation.
 *
 * Deliberately NOT `required`. Fastify's own header validation answers with its generic
 * `{statusCode, error, message}` body, which is not the Berlin Group error shape, so a TPP would receive a
 * non-standard error for the most common mistake there is. The handlers return `tppMessages` instead.
 */
export const CONSENT_SCOPED_HEADERS = {
  type: 'object',
  properties: { 'consent-id': CONSENT_ID, 'x-request-id': REQUEST_ID },
} as const;

/**
 * For a standard call that is NOT made under a consent: creating or reading a consent, obtaining a token.
 *
 * `X-Request-ID` still belongs here. It is the correlation id for the whole interface, not a property of
 * account access, and a consent created without one is a consent nobody can trace back to its request.
 */
export const CORRELATED_HEADERS = {
  type: 'object',
  properties: { 'x-request-id': REQUEST_ID },
} as const;
