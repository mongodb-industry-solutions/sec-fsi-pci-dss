import { runDrop } from '../src/vendors/setup/dropAll';
import { forEachBank } from '../src/vendors/setup/bankInstances';

// Drops every bank database FIRST, then the PSP database and the shared key vault. The order is not
// cosmetic: runDrop takes the key vault with it, and a surviving bank database would keep QE
// collections referencing DEKs that no longer exist.
forEachBank('setup:db:drop')
  .then(() => runDrop())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
