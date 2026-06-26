import { runDrop } from '../src/vendors/setup/dropAll';

runDrop()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
