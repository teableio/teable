import type { InferContractRouterOutputs } from '@orpc/contract';
import { implement, ORPCError } from '@orpc/server';
import { v2WorkflowContract, type V2WorkflowInputs } from '@teable/v2-contract-http';

type Inputs = V2WorkflowInputs;
type Outputs = InferContractRouterOutputs<typeof v2WorkflowContract>;
type SuccessData<TOutput> = TOutput extends { ok: true; data: infer TData } ? TData : never;
type ImportedTablesResult<TOutput> = TOutput extends {
  ok: true;
  data: infer TTables;
  sheets: infer TSheets;
} ? { tables: TTables; sheets: TSheets } : never;

/** Host bindings retain trusted identity, admission and upload protocol outside Table core. */
export type IV2WorkflowHostBindings = {
  [K in keyof Inputs]: (input: Inputs[K]) => Promise<K extends 'importTableFromFile'
    ? ImportedTablesResult<Outputs[K]>
    : SuccessData<Outputs[K]>>;
};

export const createV2WorkflowRouter = (
  host?: IV2WorkflowHostBindings,
  admit?: () => Promise<void>
) => {
  const os = implement(v2WorkflowContract);
  const bindings = async () => {
    await admit?.();
    if (!host) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Workflow host is not configured' });
    }
    return host;
  };
  return os.router({
    aggregateRecords: os.aggregateRecords.handler(async ({ input }) => ({
      ok: true, data: await (await bindings()).aggregateRecords(input),
    })),
    countRecords: os.countRecords.handler(async ({ input }) => ({
      ok: true, data: await (await bindings()).countRecords(input),
    })),
    importTableFromFile: os.importTableFromFile.handler(async ({ input }) => {
      const result = await (await bindings()).importTableFromFile(input);
      return { ok: true, data: result.tables, sheets: result.sheets };
    }),
    inplaceImportTableFromFile: os.inplaceImportTableFromFile.handler(async ({ input }) => ({
      ok: true, data: await (await bindings()).inplaceImportTableFromFile(input),
    })),
    getImportStatus: os.getImportStatus.handler(async ({ input }) => ({
      ok: true, data: await (await bindings()).getImportStatus(input),
    })),
  });
};
