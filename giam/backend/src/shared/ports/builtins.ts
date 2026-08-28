import { keyProviders } from './index';
import { InstanceLocalKeyProvider } from '../../modules/keys/providers/instanceLocal.provider';
import { FilesystemKeyProvider } from '../../modules/keys/providers/filesystem.provider';
import { SharedStoreKeyProvider } from '../../modules/keys/providers/sharedStore.provider';
import { KmsKeyProvider } from '../../modules/keys/providers/kms.provider';

/**
 * Registers the implementations GIAM ships with.
 *
 * Called once at boot, and again by tests that need a clean registry. Nothing here reads an
 * environment variable to decide WHICH implementation to use: it registers all of them by name, and
 * configuration names the one it wants. That is the difference between a port and a switch statement
 * with extra steps.
 *
 * A port with no entry here is declared and not yet delivered, and PORT_DELIVERY records which phase
 * owns it. It is absent rather than faked: resolving it refuses and says what is missing.
 */
export function registerBuiltinPorts(): void {
  // All four are registered in every deployment. Which one is used is configuration, and every one
  // of them is multi-replica capable, so scaling is never the reason to change it.
  keyProviders.register(new InstanceLocalKeyProvider());
  keyProviders.register(new FilesystemKeyProvider());
  keyProviders.register(new SharedStoreKeyProvider());
  keyProviders.register(new KmsKeyProvider());
}
