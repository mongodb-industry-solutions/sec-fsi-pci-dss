import { LocalKeyProvider } from './localKeyProvider';
import { AwsKmsKeyProvider } from './awsKmsKeyProvider';
import { config } from '../../../../config';

export interface OAuthKeyProvider {
  sign(data: Buffer): Promise<Buffer>;
  getPublicKeyJwk(): Promise<JsonWebKey>;
  getKid(): string;
}

export function createOAuthKeyProvider(): OAuthKeyProvider {
  const provider = config.oauth.keyProvider;
  if (provider === 'aws') {
    const keyArn = config.oauth.awsKeyArn;
    if (!keyArn) {
      throw new Error('OAUTH_AWS_KEY_ARN is required when OAUTH_KEY_PROVIDER=aws');
    }
    return new AwsKmsKeyProvider(keyArn, config.oauth.awsRegion);
  }
  const storeDir = config.oauth.keyStoreDir;
  return new LocalKeyProvider(storeDir);
}
