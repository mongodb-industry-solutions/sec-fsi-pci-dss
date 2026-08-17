import { runSeed } from '../src/vendors/seed';
import { forEachBank } from '../src/vendors/setup/bankInstances';

// Bank BEFORE the PSP: the PSP's records reference the bank's (linked accounts, consents, cards),
// never the other way round, so seeding the PSP first would point at rows that do not exist yet.
forEachBank('setup:seed')
  .then(() => runSeed())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
