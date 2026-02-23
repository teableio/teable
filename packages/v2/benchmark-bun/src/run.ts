import { createBunBenchTargets } from './bench-context';
import { runComputedCteBatchBench } from './computed-cte-batch.bench';
import { runCreateRecordBench } from './create-record.bench';
import { runCreateTableBench } from './create-table.bench';
import { runDbAdapterBench } from './db-adapter.bench';
import { runGetTableByIdBench } from './get-table-by-id.bench';
import { runRowOpsBench } from './row-ops.bench';

const exitProcess = (code: number) => {
  const bun = (globalThis as Record<string, unknown>)['Bun'] as
    | { exit?: (exitCode?: number) => void }
    | undefined;
  if (bun?.exit) {
    bun.exit(code);
    return;
  }

  const processRef = (globalThis as Record<string, unknown>)['process'] as
    | { exit?: (exitCode?: number) => void }
    | undefined;
  processRef?.exit?.(code);
};

const runAll = async () => {
  console.log('[bun-bench] starting benchmarks');
  await runDbAdapterBench();

  const sharedContext = await createBunBenchTargets();
  try {
    await runCreateTableBench(sharedContext);
    await runCreateRecordBench(sharedContext);
    await runRowOpsBench(sharedContext);
    await runComputedCteBatchBench(sharedContext);
    await runGetTableByIdBench(sharedContext);
  } finally {
    await sharedContext.dispose();
  }

  console.log('[bun-bench] benchmarks finished');
};

try {
  await runAll();
  exitProcess(0);
} catch (error) {
  console.error(error);
  exitProcess(1);
  throw error;
}
