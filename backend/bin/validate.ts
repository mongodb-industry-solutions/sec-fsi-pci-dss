import { runValidate } from '../src/vendors/setup/validateSetup';

runValidate()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
