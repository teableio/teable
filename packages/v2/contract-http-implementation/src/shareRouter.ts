import { implement, ORPCError } from '@orpc/server';
import { PUBLIC_ROW_ADMISSION_BUSY_CODE, v2ShareContract } from '@teable/v2-contract-http';
import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract';

type Inputs = InferContractRouterInputs<typeof v2ShareContract>;
type Outputs = InferContractRouterOutputs<typeof v2ShareContract>;
type SuccessData<T> = T extends { ok: true; data: infer TData } ? TData : never;

/** Required real host bindings; credentials and request identity stay in the host closure. */
export type IShareHostBindings = {
  [K in keyof Inputs]: (input: Inputs[K]) => Promise<SuccessData<Outputs[K]>>;
};

export const createV2ShareRouter = (host?: IShareHostBindings) => {
  const os = implement(v2ShareContract).use(async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      const status = error instanceof ORPCError ? error.status :
        error && typeof error === 'object' && 'getStatus' in error && typeof error.getStatus === 'function' ? error.getStatus() : 500;
      if (status === 400) throw new ORPCError('BAD_REQUEST', { message: 'Invalid share request' });
      if (status === 401) throw new ORPCError('UNAUTHORIZED', { message: 'Share authentication required' });
      if (status === 402) {
        const data = error && typeof error === 'object' && 'data' in error ? error.data : undefined;
        const domainCode = data && typeof data === 'object' && 'domainCode' in data
          && data.domainCode === 'usage.max_rows_exceeded' ? data.domainCode : undefined;
        throw new ORPCError('PAYMENT_REQUIRED', {
          status: 402,
          message: 'Share write exceeds the space usage limit',
          data: domainCode ? { domainCode } : undefined,
        });
      }
      if (status === 403) throw new ORPCError('FORBIDDEN', { message: 'Share operation is not allowed' });
      if (status === 404) throw new ORPCError('NOT_FOUND', { message: 'Shared resource not found' });
      if (status === 409) throw new ORPCError('CONFLICT', { message: 'Share operation conflicts with current state' });
      if (status === 503) {
        const data = error && typeof error === 'object' && 'data' in error ? error.data : undefined;
        if (data && typeof data === 'object' && 'domainCode' in data && data.domainCode === PUBLIC_ROW_ADMISSION_BUSY_CODE) {
          throw new ORPCError('SERVICE_UNAVAILABLE', {
            message: 'Public row admission is busy. Please try again shortly.',
            data: { domainCode: PUBLIC_ROW_ADMISSION_BUSY_CODE, domainTags: ['infrastructure'] },
          });
        }
      }
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Share operation failed' });
    }
  });
  const bindings = () => {
    if (!host) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Share host is not configured' });
    return host;
  };
  return os.router({
    authenticate: os.authenticate.handler(async ({ input }) => ({ ok: true, data: await bindings().authenticate(input) })),
    get: os.get.handler(async ({ input }) => ({ ok: true, data: await bindings().get(input) })),
    listRecords: os.listRecords.handler(async ({ input }) => ({ ok: true, data: await bindings().listRecords(input) })),
    getRecord: os.getRecord.handler(async ({ input }) => ({ ok: true, data: await bindings().getRecord(input) })),
    countRecords: os.countRecords.handler(async ({ input }) => ({ ok: true, data: await bindings().countRecords(input) })),
    aggregateRecords: os.aggregateRecords.handler(async ({ input }) => ({ ok: true, data: await bindings().aggregateRecords(input) })),
    copy: os.copy.handler(async ({ input }) => ({ ok: true, data: await bindings().copy(input) })),
    submitRecord: os.submitRecord.handler(async ({ input }) => ({ ok: true, data: await bindings().submitRecord(input) })),
    createRecords: os.createRecords.handler(async ({ input }) => ({ ok: true, data: await bindings().createRecords(input) })),
    updateRecord: os.updateRecord.handler(async ({ input }) => ({ ok: true, data: await bindings().updateRecord(input) })),
    deleteRecords: os.deleteRecords.handler(async ({ input }) => ({ ok: true, data: await bindings().deleteRecords(input) })),
  });
};
