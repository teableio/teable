import type { ILogger } from './logger.js';
import type { IFunctionToolSpec } from './openai.js';

export interface ITeableToolClient {
  listTables(baseId: string): Promise<unknown>;
  getTableSchema(tableId: string): Promise<unknown>;
  queryRecords(
    tableId: string,
    options: { viewId?: string; take?: number; search?: string }
  ): Promise<unknown>;
  createRecords(tableId: string, records: { fields: Record<string, unknown> }[]): Promise<unknown>;
  updateRecords(
    tableId: string,
    records: { id: string; fields: Record<string, unknown> }[]
  ): Promise<unknown>;
}

export interface IToolExecutor {
  specs: IFunctionToolSpec[];
  execute(name: string, argsJson: string): Promise<{ ok: boolean; result: unknown }>;
}

export const createTeableToolClient = (
  config: { baseUrl: string; token: string },
  logger: ILogger,
  fetchImpl: typeof fetch = fetch
): ITeableToolClient => {
  const request = async (
    path: string,
    init?: { method?: string; body?: unknown }
  ): Promise<unknown> => {
    const url = new URL(path, config.baseUrl);
    const response = await fetchImpl(url, {
      method: init?.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Teable API ${init?.method ?? 'GET'} ${url.pathname} -> HTTP ${response.status} ${body.slice(0, 300)}`
      );
    }
    return response.json();
  };

  return {
    listTables(baseId) {
      return request(`/api/base/${baseId}/table`);
    },
    getTableSchema(tableId) {
      return request(`/api/table/${tableId}`);
    },
    queryRecords(tableId, options) {
      const params = new URLSearchParams({
        fieldKeyType: 'name',
        cellFormat: 'text',
        take: String(Math.min(options.take ?? 20, 50)),
      });
      if (options.viewId) {
        params.set('viewId', options.viewId);
      }
      if (options.search) {
        params.set('search', JSON.stringify([options.search, options.search]));
      }
      logger.debug('query_records', { tableId, params: params.toString() });
      return request(`/api/table/${tableId}/record?${params.toString()}`);
    },
    createRecords(tableId, records) {
      return request(`/api/table/${tableId}/record`, {
        method: 'POST',
        body: { records, fieldKeyType: 'name', typecast: true },
      });
    },
    updateRecords(tableId, records) {
      return request(`/api/table/${tableId}/record`, {
        method: 'PATCH',
        body: { records, fieldKeyType: 'name', typecast: true },
      });
    },
  };
};

export const toolSpecs: IFunctionToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'list_tables',
      description: 'List the tables of a base with their ids, names and field summaries.',
      parameters: {
        type: 'object',
        properties: {
          baseId: { type: 'string', description: 'Base id (bse…). Defaults to the current base.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_table_schema',
      description:
        'Get one table: fields (id, name, type, primary flag) and views (id, name, type). Use this before writing records.',
      parameters: {
        type: 'object',
        properties: {
          tableId: {
            type: 'string',
            description: 'Table id (tbl…). Defaults to the current table.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_records',
      description:
        'Read records (max 50) from a table as human-readable values keyed by field name. Prefer a viewId for filtered data.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          viewId: { type: 'string' },
          take: { type: 'number', description: '1-50, default 20' },
          search: { type: 'string', description: 'Free-text search across the table' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_records',
      description:
        'Create records. `fields` keys are field NAMES from the table schema; values must match the field type (dates as ISO strings, selects as option names, numbers as numbers).',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          records: {
            type: 'array',
            items: {
              type: 'object',
              properties: { fields: { type: 'object', additionalProperties: true } },
              required: ['fields'],
            },
          },
        },
        required: ['records'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_records',
      description:
        'Update records by id (records[].id). `fields` keys are field NAMES; only include the fields that change.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          records: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                fields: { type: 'object', additionalProperties: true },
              },
              required: ['id', 'fields'],
            },
          },
        },
        required: ['records'],
      },
    },
  },
];

const parseArgs = (argsJson: string): Record<string, unknown> => {
  if (!argsJson.trim()) {
    return {};
  }
  const parsed = JSON.parse(argsJson) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('tool arguments must be a JSON object');
  }
  return parsed as Record<string, unknown>;
};

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value) {
    throw new Error(`\`${name}\` is required`);
  }
  return value;
};

/**
 * Executes tool calls against the Teable REST API. Deletion tools are
 * deliberately not exposed; writes require explicit user intent in the chat.
 */
export const createToolExecutor = (params: {
  client: ITeableToolClient;
  current?: { baseId?: string; tableId?: string };
}): IToolExecutor => {
  const { client, current } = params;

  return {
    specs: toolSpecs,
    async execute(name, argsJson) {
      try {
        const args = parseArgs(argsJson);
        switch (name) {
          case 'list_tables': {
            const baseId = (args.baseId as string) || current?.baseId;
            requireString(baseId, 'baseId');
            return { ok: true, result: await client.listTables(baseId as string) };
          }
          case 'get_table_schema': {
            const tableId = (args.tableId as string) || current?.tableId;
            requireString(tableId, 'tableId');
            return { ok: true, result: await client.getTableSchema(tableId as string) };
          }
          case 'query_records': {
            const tableId = (args.tableId as string) || current?.tableId;
            requireString(tableId, 'tableId');
            return {
              ok: true,
              result: await client.queryRecords(tableId as string, {
                viewId: args.viewId as string | undefined,
                take: args.take as number | undefined,
                search: args.search as string | undefined,
              }),
            };
          }
          case 'create_records': {
            const tableId = (args.tableId as string) || current?.tableId;
            requireString(tableId, 'tableId');
            const records = args.records as { fields: Record<string, unknown> }[] | undefined;
            if (!Array.isArray(records) || records.length === 0) {
              throw new Error('`records` must be a non-empty array');
            }
            return { ok: true, result: await client.createRecords(tableId as string, records) };
          }
          case 'update_records': {
            const tableId = (args.tableId as string) || current?.tableId;
            requireString(tableId, 'tableId');
            const records = args.records as
              | { id: string; fields: Record<string, unknown> }[]
              | undefined;
            if (!Array.isArray(records) || records.length === 0) {
              throw new Error('`records` must be a non-empty array');
            }
            return { ok: true, result: await client.updateRecords(tableId as string, records) };
          }
          default:
            return { ok: false, result: `unknown tool: ${name}` };
        }
      } catch (error) {
        return { ok: false, result: error instanceof Error ? error.message : String(error) };
      }
    },
  };
};
