import { runHeadlessCli } from './cli-main';

void runHeadlessCli().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
