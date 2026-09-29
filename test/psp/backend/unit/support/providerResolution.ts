/**
 * Stub for the provider resolution port used by the bank-facing clients.
 *
 * Resolving a capability's endpoint and exchanging its credential both read the provider arrangement
 * record, so a unit test that leaves them real opens a QE client, loads crypt_shared and provisions every
 * DEK just to learn a base URL. That is integration cost paid by a unit test, and it hides the property
 * under test behind the plumbing. Here the port answers directly, so the test exercises the request the
 * client builds and the bank's reply, which is what it is about.
 */

export interface ProviderResolutionStub {
  getProviderBaseUrl: (providerType: string) => Promise<{ baseUrl?: string; error?: string }>;
  getProviderAccessToken: (providerType: string) => Promise<{ accessToken?: string; error?: string }>;
  resetProviderTokenCache: () => void;
}

/** Module shape for `vi.mock` on providerAccessToken.service. */
export function stubProviderResolution(
  baseUrl = 'http://bank.test:8083',
  accessToken = 'stub-provider-token',
): ProviderResolutionStub {
  return {
    getProviderBaseUrl: async () => ({ baseUrl }),
    getProviderAccessToken: async () => ({ accessToken }),
    resetProviderTokenCache: () => {},
  };
}
