import type { IExecutionContext, ITableRepository, Table } from '@teable/v2-core';
import type {
  TableSearchAccessPathCapabilityReader,
  TableSearchAccessPathReconciler,
  TableSearchVectorStatusReader,
} from '@teable/v2-table-query-ops';
import { describe, expect, it, vi } from 'vitest';

import {
  executeGetSearchAccessPathCapabilitiesEndpoint,
  executeGetSearchAccessPathStatusEndpoint,
  executeReconcileSearchAccessPathEndpoint,
} from './searchAccessPath';

const tableId = `tbl${'a'.repeat(16)}`;
const context = {} as IExecutionContext;
const table = {} as Table;
const ok = <T>(value: T) => ({ isErr: () => false, value });

const tableRepository = (value: Table | null = table) =>
  ({
    findOne: vi.fn().mockResolvedValue(ok(value)),
  }) as unknown as ITableRepository;

describe('search access path HTTP handlers', () => {
  it('returns native managed status for an existing table', async () => {
    const statusReader = {
      read: vi.fn().mockResolvedValue(
        ok({
          tableId,
          state: 'ready',
          configured: true,
          semantics: 'substring',
          provider: 'pg_trgm',
          accessPath: 'generated_text',
          coveredFieldCount: 2,
        })
      ),
    } as TableSearchVectorStatusReader;

    const result = await executeGetSearchAccessPathStatusEndpoint(
      context,
      { tableId },
      tableRepository(),
      statusReader
    );

    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, data: { status: { state: 'ready', coveredFieldCount: 2 } } },
    });
    expect(statusReader.read).toHaveBeenCalledWith(context, tableId);
  });

  it('returns not found before reading status for a missing table', async () => {
    const statusReader = {
      read: vi.fn(),
    } as unknown as TableSearchVectorStatusReader;

    const result = await executeGetSearchAccessPathStatusEndpoint(
      context,
      { tableId },
      tableRepository(null),
      statusReader
    );

    expect(result.status).toBe(404);
    expect(statusReader.read).not.toHaveBeenCalled();
  });

  it('returns database capabilities through the capability reader', async () => {
    const capabilityReader = {
      read: vi.fn().mockResolvedValue(
        ok([
          {
            provider: 'pg_trgm',
            extensionName: 'pg_trgm',
            operatorClass: 'gin_trgm_ops',
            operatorClassInstalled: true,
            minimumProbeLength: 3,
            state: 'ready',
            installed: true,
            available: true,
            preloaded: true,
          },
        ])
      ),
    } as TableSearchAccessPathCapabilityReader;

    const result = await executeGetSearchAccessPathCapabilitiesEndpoint(context, capabilityReader);

    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, data: { capabilities: [{ provider: 'pg_trgm', state: 'ready' }] } },
    });
  });

  it('rejects reconcile when the host mutation guard is disabled', async () => {
    const reconciler = { reconcile: vi.fn() } as unknown as TableSearchAccessPathReconciler;

    const result = await executeReconcileSearchAccessPathEndpoint(
      context,
      { tableId, mode: 'rebuild' },
      tableRepository(),
      reconciler,
      false
    );

    expect(result).toMatchObject({
      status: 403,
      body: {
        ok: false,
        error: { code: 'table_query_ops.search_access_path_mutation_disabled' },
      },
    });
    expect(reconciler.reconcile).not.toHaveBeenCalled();
  });

  it('delegates an allowed reconcile with guarded adapter controls', async () => {
    const reconciler = {
      reconcile: vi.fn().mockResolvedValue(
        ok({
          action: 'created',
          tableId,
          definitionKey: 'definition-key',
          generatedColumnName: '__teable_search',
          indexName: 'idx_teable_search',
          languageConfig: 'simple',
          semantics: 'substring',
          provider: 'pg_trgm',
          fieldIds: ['fld-primary'],
          status: 'ready',
        })
      ),
    } as TableSearchAccessPathReconciler;

    const result = await executeReconcileSearchAccessPathEndpoint(
      context,
      {
        tableId,
        mode: 'create',
        semantics: 'substring',
        provider: 'pg_trgm',
        fieldIds: ['fld-primary'],
      },
      tableRepository(),
      reconciler,
      true
    );

    expect(result.status).toBe(200);
    expect(reconciler.reconcile).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        table,
        mode: 'create',
        validationMode: 'real_ddl',
        allowLargeTableRewrite: false,
      })
    );
  });
});
