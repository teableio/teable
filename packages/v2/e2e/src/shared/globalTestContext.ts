/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Global shared test context for E2E tests.
 *
 * This module provides a singleton test container and Express server that is
 * shared across all test files in the same worker process. This significantly
 * reduces test execution time by avoiding the overhead of starting a new
 * PostgreSQL container for each test file.
 *
 * Usage in test files:
 * ```ts
 * import { getSharedTestContext } from './shared/globalTestContext';
 *
 * describe('my test', () => {
 *   let ctx: Awaited<ReturnType<typeof getSharedTestContext>>;
 *
 *   beforeAll(async () => {
 *     ctx = await getSharedTestContext();
 *   });
 *
 *   // No need to call dispose - it's handled globally
 * });
 * ```
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  createTablesOkResponseSchema,
  deleteFieldOkResponseSchema,
  deleteRecordsOkResponseSchema,
  deleteTableOkResponseSchema,
  duplicateRecordOkResponseSchema,
  getTableByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
  listTablesOkResponseSchema,
  renameTableOkResponseSchema,
  updateRecordOkResponseSchema,
  clearOkResponseSchema,
  pasteOkResponseSchema,
  importCsvOkResponseSchema,
  importRecordsOkResponseSchema,
  deleteByRangeOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import type {
  ICreateTableCommandInput,
  ICreateFieldCommandInput,
  ICreateTablesCommandInput,
  IPasteCommandInput,
  IImportCsvCommandInput,
  IImportRecordsCommandInput,
  RecordFilter,
} from '@teable/v2-core';
import { ActorId, MemoryUndoRedoStore, v2CoreTokens } from '@teable/v2-core';
import { registerV2ImportServices } from '@teable/v2-import';
import express from 'express';

// Default test user that will be used as the actorId for all API requests
export const TEST_USER = {
  id: 'usrTestUserId',
  name: 'test',
  email: 'test@e2e.com',
} as const;

export interface SharedTestContext {
  testContainer: IV2NodeTestContainer;
  baseId: string;
  baseUrl: string;
  // Test user info - use this when testing createdBy/lastModifiedBy fields
  testUser: typeof TEST_USER;
  // API helpers
  createTable: (
    payload: ICreateTableCommandInput
  ) => Promise<ReturnType<typeof parseCreateTableResponse>>;
  createTables: (
    payload: ICreateTablesCommandInput
  ) => Promise<ReturnType<typeof parseCreateTablesResponse>>;
  createField: (
    payload: ICreateFieldCommandInput
  ) => Promise<ReturnType<typeof parseCreateFieldResponse>>;
  deleteField: (payload: { tableId: string; fieldId: string }) => Promise<void>;
  deleteTable: (tableId: string) => Promise<void>;
  renameTable: (
    tableId: string,
    name: string
  ) => Promise<ReturnType<typeof parseRenameTableResponse>>;
  listTables: (options?: {
    baseId?: string;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    q?: string;
  }) => Promise<ReturnType<typeof parseListTablesResponse>>;
  createRecord: (
    tableId: string,
    fields: Record<string, unknown>
  ) => Promise<ReturnType<typeof parseCreateRecordResponse>>;
  createRecords: (
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>
  ) => Promise<ReturnType<typeof parseCreateRecordsResponse>>;
  updateRecord: (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => Promise<ReturnType<typeof parseUpdateRecordResponse>>;
  duplicateRecord: (
    tableId: string,
    recordId: string
  ) => Promise<ReturnType<typeof parseDuplicateRecordResponse>>;
  deleteRecord: (tableId: string, recordId: string) => Promise<void>;
  deleteRecords: (tableId: string, recordIds: string[]) => Promise<void>;
  listRecords: (
    tableId: string,
    options?: { limit?: number; offset?: number; baseId?: string }
  ) => Promise<Array<{ id: string; fields: Record<string, unknown> }>>;
  listRecordsWithPagination: (
    tableId: string,
    options?: { limit?: number; offset?: number; baseId?: string }
  ) => Promise<ReturnType<typeof parseListRecordsResponse>>;
  getTableById: (
    tableId: string,
    baseIdParam?: string
  ) => Promise<ReturnType<typeof parseGetTableResponse>>;
  clear: (payload: {
    tableId: string;
    viewId: string;
    ranges: [number, number][];
    type?: 'columns' | 'rows';
    filter?: RecordFilter;
    sort?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
    groupBy?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
    projection?: string[];
  }) => Promise<ReturnType<typeof parseClearResponse>>;
  deleteByRange: (payload: {
    tableId: string;
    viewId: string;
    ranges: [number, number][];
    type?: 'columns' | 'rows';
    filter?: RecordFilter;
  }) => Promise<ReturnType<typeof parseDeleteByRangeResponse>>;
  paste: (payload: IPasteCommandInput) => Promise<ReturnType<typeof parsePasteResponse>>;
  importCsv: (
    payload: IImportCsvCommandInput
  ) => Promise<ReturnType<typeof parseImportCsvResponse>>;
  importRecords: (
    payload: IImportRecordsCommandInput
  ) => Promise<ReturnType<typeof parseImportRecordsResponse>>;
  drainOutbox: (maxRounds?: number) => Promise<void>;
  clearLogs: () => void;
  getLastComputedPlan: () => ReturnType<IV2NodeTestContainer['getLastComputedPlan']>;
}

// Singleton state
let sharedContext: SharedTestContext | null = null;
let initPromise: Promise<SharedTestContext> | null = null;
let server: Server | null = null;

// Response parsers
const parseCreateTableResponse = (rawBody: unknown) => {
  const parsed = createTableOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse create table response');
  }
  return parsed.data.data.table;
};

const parseCreateFieldResponse = (rawBody: unknown) => {
  const parsed = createFieldOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse create field response');
  }
  return parsed.data.data.table;
};

const parseCreateRecordResponse = (rawBody: unknown) => {
  const parsed = createRecordOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse create record response');
  }
  return parsed.data.data.record;
};

const parseCreateRecordsResponse = (rawBody: unknown) => {
  const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse create records response');
  }
  return parsed.data.data.records;
};

const parseUpdateRecordResponse = (rawBody: unknown) => {
  const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse update record response');
  }
  return parsed.data.data.record;
};

const parseDuplicateRecordResponse = (rawBody: unknown) => {
  const parsed = duplicateRecordOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse duplicate record response');
  }
  return parsed.data.data.record;
};

const parseListRecordsResponse = (rawBody: unknown) => {
  const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse list records response');
  }
  return parsed.data.data;
};

const parseGetTableResponse = (rawBody: unknown) => {
  const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse get table response');
  }
  return parsed.data.data.table;
};

const parseClearResponse = (rawBody: unknown) => {
  const parsed = clearOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse clear response');
  }
  return parsed.data.data;
};

const parseDeleteByRangeResponse = (rawBody: unknown) => {
  const parsed = deleteByRangeOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse deleteByRange response');
  }
  return parsed.data.data;
};

const parseCreateTablesResponse = (rawBody: unknown) => {
  const parsed = createTablesOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse create tables response');
  }
  return parsed.data.data.tables;
};

const parseListTablesResponse = (rawBody: unknown) => {
  const parsed = listTablesOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse list tables response');
  }
  return parsed.data.data.tables;
};

const parseRenameTableResponse = (rawBody: unknown) => {
  const parsed = renameTableOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse rename table response');
  }
  return parsed.data.data;
};

const parsePasteResponse = (rawBody: unknown) => {
  const parsed = pasteOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse paste response');
  }
  return parsed.data.data;
};

const parseImportCsvResponse = (rawBody: unknown) => {
  const parsed = importCsvOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse import csv response');
  }
  return parsed.data.data;
};

const parseImportRecordsResponse = (rawBody: unknown) => {
  const parsed = importRecordsOkResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error('Failed to parse import records response');
  }
  return parsed.data.data;
};

/**
 * Initialize the shared test context.
 * This is called once per worker process.
 */
const initSharedContext = async (): Promise<SharedTestContext> => {
  const testContainer = await createV2NodeTestContainer();
  const baseId = testContainer.baseId.toString();

  // Register import services (CSV, Excel adapters)
  registerV2ImportServices(testContainer.container);

  // Insert the test user into the database
  await testContainer.db
    .insertInto('users')
    .values({ id: TEST_USER.id, name: TEST_USER.name, email: TEST_USER.email })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();

  // Create actorId for execution context
  const actorIdResult = ActorId.create(TEST_USER.id);
  if (actorIdResult.isErr()) {
    throw new Error(`Invalid test user id: ${actorIdResult.error.message}`);
  }
  const actorId = actorIdResult.value;

  // Enable undo/redo in e2e by default.
  testContainer.container.registerInstance(v2CoreTokens.undoRedoStore, new MemoryUndoRedoStore());

  const app = express();
  app.use(
    createV2ExpressRouter({
      createContainer: () => testContainer.container,
      createExecutionContext: () => ({ actorId, windowId: 'e2e-window' }),
    })
  );

  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // API helpers
  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create table: ${errorText}`);
    }
    return parseCreateTableResponse(await response.json());
  };

  const createField = async (payload: ICreateFieldCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create field: ${errorText}`);
    }
    return parseCreateFieldResponse(await response.json());
  };

  const createTables = async (payload: ICreateTablesCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/createTables`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create tables: ${errorText}`);
    }
    return parseCreateTablesResponse(await response.json());
  };

  const deleteField = async (payload: { tableId: string; fieldId: string }) => {
    const response = await fetch(`${baseUrl}/tables/deleteField`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId, ...payload }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete field: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = deleteFieldOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse delete field response');
    }
  };

  const deleteTable = async (tableId: string) => {
    const response = await fetch(`${baseUrl}/tables/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId, tableId }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = deleteTableOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse delete table response');
    }
  };

  const renameTable = async (tableId: string, name: string) => {
    const response = await fetch(`${baseUrl}/tables/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, name }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to rename table: ${errorText}`);
    }
    return parseRenameTableResponse(await response.json());
  };

  const listTables = async (options?: {
    baseId?: string;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    q?: string;
  }) => {
    const params = new URLSearchParams({ baseId: options?.baseId ?? baseId });
    if (options?.sortBy) params.set('sortBy', options.sortBy);
    if (options?.sortDirection) params.set('sortDirection', options.sortDirection);
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.offset !== undefined) params.set('offset', String(options.offset));
    if (options?.q) params.set('q', options.q);
    const response = await fetch(`${baseUrl}/tables/list?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list tables: ${errorText}`);
    }
    return parseListTablesResponse(await response.json());
  };

  const createRecord = async (tableId: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create record: ${errorText}`);
    }
    return parseCreateRecordResponse(await response.json());
  };

  const createRecords = async (
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>
  ) => {
    const response = await fetch(`${baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, records }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create records: ${errorText}`);
    }
    return parseCreateRecordsResponse(await response.json());
  };

  const updateRecord = async (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordId, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update record: ${errorText}`);
    }
    return parseUpdateRecordResponse(await response.json());
  };

  const duplicateRecord = async (tableId: string, recordId: string) => {
    const response = await fetch(`${baseUrl}/tables/duplicateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordId }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to duplicate record: ${errorText}`);
    }
    return parseDuplicateRecordResponse(await response.json());
  };

  const deleteRecord = async (tableId: string, recordId: string) => {
    const response = await fetch(`${baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordIds: [recordId] }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = deleteRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse delete record response');
    }
  };

  const deleteRecords = async (tableId: string, recordIds: string[]) => {
    const response = await fetch(`${baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordIds }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete records: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = deleteRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse delete records response');
    }
  };

  const drainOutbox = async (maxRounds = 10) => {
    for (let i = 0; i < maxRounds; i += 1) {
      const drained = await testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listRecordsWithPagination = async (
    tableId: string,
    options?: { limit?: number; offset?: number; baseId?: string }
  ) => {
    await drainOutbox();
    const params = new URLSearchParams({ tableId });
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.offset !== undefined) params.set('offset', String(options.offset));
    if (options?.baseId) params.set('baseId', options.baseId);
    const response = await fetch(`${baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list records: ${errorText}`);
    }
    return parseListRecordsResponse(await response.json());
  };

  const listRecords = async (
    tableId: string,
    options?: { limit?: number; offset?: number; baseId?: string }
  ) => {
    const result = await listRecordsWithPagination(tableId, options);
    return result.records;
  };

  const getTableById = async (tableId: string, baseIdParam?: string) => {
    const params = new URLSearchParams({ baseId: baseIdParam ?? baseId, tableId });
    const response = await fetch(`${baseUrl}/tables/get?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get table: ${errorText}`);
    }
    return parseGetTableResponse(await response.json());
  };

  const clear = async (payload: {
    tableId: string;
    viewId: string;
    ranges: [number, number][];
    type?: 'columns' | 'rows';
    filter?: RecordFilter;
    sort?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
    groupBy?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
    projection?: string[];
  }) => {
    const response = await fetch(`${baseUrl}/tables/clear`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to clear: ${errorText}`);
    }
    return parseClearResponse(await response.json());
  };

  const deleteByRange = async (payload: {
    tableId: string;
    viewId: string;
    ranges: [number, number][];
    type?: 'columns' | 'rows';
    filter?: RecordFilter;
    sort?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
    search?: [string, string, boolean?];
    groupBy?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
  }) => {
    const response = await fetch(`${baseUrl}/tables/deleteByRange`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to deleteByRange: ${errorText}`);
    }
    return parseDeleteByRangeResponse(await response.json());
  };

  const paste = async (payload: IPasteCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/paste`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to paste: ${errorText}`);
    }
    return parsePasteResponse(await response.json());
  };

  const importCsv = async (payload: IImportCsvCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/importCsv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to import csv: ${errorText}`);
    }
    return parseImportCsvResponse(await response.json());
  };

  const importRecords = async (payload: IImportRecordsCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/importRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to import records: ${errorText}`);
    }
    return parseImportRecordsResponse(await response.json());
  };

  return {
    testContainer,
    baseId,
    baseUrl,
    testUser: TEST_USER,
    createTable,
    createTables,
    createField,
    deleteField,
    deleteTable,
    renameTable,
    listTables,
    createRecord,
    createRecords,
    updateRecord,
    duplicateRecord,
    deleteRecord,
    deleteRecords,
    listRecords,
    listRecordsWithPagination,
    getTableById,
    clear,
    deleteByRange,
    paste,
    importCsv,
    importRecords,
    drainOutbox,
    clearLogs: () => testContainer.clearLogs(),
    getLastComputedPlan: () => testContainer.getLastComputedPlan(),
  };
};

/**
 * Get the shared test context.
 * The first call initializes the context; subsequent calls return the same instance.
 */
export const getSharedTestContext = async (): Promise<SharedTestContext> => {
  if (sharedContext) {
    return sharedContext;
  }

  if (!initPromise) {
    initPromise = initSharedContext();
  }

  sharedContext = await initPromise;
  return sharedContext;
};

/**
 * Dispose the shared test context.
 * This should only be called by the global teardown.
 */
export const disposeSharedTestContext = async (): Promise<void> => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  if (sharedContext) {
    // Drain any pending outbox tasks before disposing to avoid
    // "terminating connection due to administrator command" errors
    try {
      await sharedContext.drainOutbox();
    } catch {
      // Ignore errors during cleanup - the outbox may already be empty or unavailable
    }
    await sharedContext.testContainer.dispose();
    sharedContext = null;
    initPromise = null;
  }
};
