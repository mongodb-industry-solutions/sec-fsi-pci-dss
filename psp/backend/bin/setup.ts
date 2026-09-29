import { runSetup } from '../src/vendors/setup';
import { forEachBank } from '../src/vendors/setup/bankInstances';

const reset = process.argv.includes('--reset');

// One entry point for the whole platform: the PSP first, then every registered bank instance, each
// against its own database. The bank list is data, so a third bank changes no command.
runSetup(reset)
  .then(() => forEachBank('setup:db', reset ? ['--reset'] : []))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
