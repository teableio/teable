import type { ExplainOptions, IExplainService } from '@teable/v2-command-explain';
import { domainError, type IExecutionContext } from '@teable/v2-core';
import { err } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { executeExplainUpdateRecordEndpoint } from './explainCommand';

const context = {} as IExecutionContext;

const input = {
  tableId: `tbl${'a'.repeat(16)}`,
  recordId: `rec${'b'.repeat(16)}`,
  fields: { [`fld${'c'.repeat(16)}`]: 'updated' },
};

describe('command explain HTTP adapter', () => {
  it('forwards the data-estimate opt-in to the shared explain service', async () => {
    const explain = vi.fn(
      async (_context: IExecutionContext, _command: unknown, _options?: ExplainOptions) =>
        err(domainError.validation({ message: 'stop after capturing explain options' }))
    );
    const service = { explain } as unknown as IExplainService;

    await executeExplainUpdateRecordEndpoint(
      context,
      { ...input, includeDataEstimate: true, includeGraph: true },
      service
    );

    expect(explain).toHaveBeenCalledOnce();
    expect(explain.mock.calls[0]?.[2]).toMatchObject({
      includeDataEstimate: true,
      includeGraph: true,
    });
  });

  it('forwards the contract default when data estimates are not requested', async () => {
    const explain = vi.fn(
      async (_context: IExecutionContext, _command: unknown, _options?: ExplainOptions) =>
        err(domainError.validation({ message: 'stop after capturing explain options' }))
    );
    const service = { explain } as unknown as IExplainService;

    await executeExplainUpdateRecordEndpoint(context, input, service);

    expect(explain.mock.calls[0]?.[2]).toMatchObject({ includeDataEstimate: false });
  });
});
