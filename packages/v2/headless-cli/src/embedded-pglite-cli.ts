import { runEmbeddedPgliteCli } from './embedded-pglite';

void runEmbeddedPgliteCli().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
