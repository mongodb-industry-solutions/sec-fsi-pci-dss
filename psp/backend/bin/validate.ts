import { runValidate } from '../src/vendors/setup/validateSetup';
import { forEachBank } from '../src/vendors/setup/bankInstances';

runValidate()
  .then(() => forEachBank('setup:check'))
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
