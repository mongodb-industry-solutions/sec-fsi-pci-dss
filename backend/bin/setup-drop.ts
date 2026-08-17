import { runDrop } from '../src/vendors/setup/dropAll';
import { forEachBank } from '../src/vendors/setup/bankInstances';

// Drops every bank database too, so --reset rebuilds the whole platform reproducibly.
forEachBank('setup:db:drop')
  .then(() => runDrop())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
