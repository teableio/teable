import { runComputedCteBatchBench } from './computed-cte-batch.bench';
import { runCreateRecordBench } from './create-record.bench';
import { runCreateTableBench } from './create-table.bench';
import { runDbAdapterBench } from './db-adapter.bench';
import { runGetTableByIdBench } from './get-table-by-id.bench';

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
  await runCreateTableBench();
  await runCreateRecordBench();
  await runComputedCteBatchBench();
  await runGetTableByIdBench();
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
