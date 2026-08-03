import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { streamSSE } from '../utils/sse';
import { z } from '../zod';

export const GET_V2_SCHEMA_INTEGRITY_DECISION = '/v2/integrity/base/{baseId}/decision';
export const CHECK_V2_BASE_SCHEMA_INTEGRITY_STREAM = '/v2/integrity/base/{baseId}/check-stream';
export const REPAIR_V2_BASE_SCHEMA_INTEGRITY_STREAM = '/v2/integrity/base/{baseId}/repair-stream';
export const CHECK_V2_TABLE_SCHEMA_INTEGRITY_STREAM = '/v2/integrity/table/{tableId}/check-stream';
export const REPAIR_V2_TABLE_SCHEMA_INTEGRITY_STREAM =
  '/v2/integrity/table/{tableId}/repair-stream';
const schemaIntegrityStreamErrorPrefix = 'Schema integrity stream failed';

const v2SchemaIntegrityFeature = 'schemaIntegrity' as const;

export const v2SchemaIntegrityDecisionVoSchema = z.object({
  feature: z.literal(v2SchemaIntegrityFeature),
  useV2: z.boolean(),
  reason: z.string(),
});

export type IV2SchemaIntegrityDecisionVo = z.infer<typeof v2SchemaIntegrityDecisionVoSchema>;

export const v2SchemaIntegrityDetailsSchema = z.object({
  missing: z.array(z.string()).optional(),
  missingItems: z
    .array(
      z.object({
        code: z.string().optional(),
        message: z.object({
          key: z.string().optional(),
          values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
          fallback: z.string().optional(),
        }),
        description: z
          .object({
            key: z.string().optional(),
            values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
            fallback: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),
  extra: z.array(z.string()).optional(),
  extraItems: z
    .array(
      z.object({
        code: z.string().optional(),
        message: z.object({
          key: z.string().optional(),
          values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
          fallback: z.string().optional(),
        }),
        description: z
          .object({
            key: z.string().optional(),
            values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
            fallback: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),
  statementCount: z.number().optional(),
  statements: z
    .array(
      z.object({
        sql: z.string(),
        parameters: z.array(z.unknown()).optional(),
      })
    )
    .optional(),
});

export const v2SchemaIntegrityI18nMessageSchema = z.object({
  key: z.string().optional(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  fallback: z.string().optional(),
});
export type IV2SchemaIntegrityI18nMessage = z.infer<typeof v2SchemaIntegrityI18nMessageSchema>;

export const v2SchemaIntegrityManualRepairSchemaPropertySchema = z.object({
  type: z.enum(['string', 'boolean']),
  widget: z.enum(['select', 'text', 'textarea', 'checkbox']).optional(),
  title: v2SchemaIntegrityI18nMessageSchema.optional(),
  description: v2SchemaIntegrityI18nMessageSchema.optional(),
  options: z
    .array(
      z.object({
        value: z.string(),
        label: v2SchemaIntegrityI18nMessageSchema,
        description: v2SchemaIntegrityI18nMessageSchema.optional(),
      })
    )
    .optional(),
  defaultValue: z.union([z.string(), z.boolean()]).optional(),
});
export type IV2SchemaIntegrityManualRepairSchemaProperty = z.infer<
  typeof v2SchemaIntegrityManualRepairSchemaPropertySchema
>;

export const v2SchemaIntegrityManualRepairSchemaSchema = z.object({
  type: z.literal('object'),
  title: v2SchemaIntegrityI18nMessageSchema.optional(),
  description: v2SchemaIntegrityI18nMessageSchema.optional(),
  submitLabel: v2SchemaIntegrityI18nMessageSchema.optional(),
  required: z.array(z.string()).optional(),
  properties: z.record(z.string(), v2SchemaIntegrityManualRepairSchemaPropertySchema),
});
export type IV2SchemaIntegrityManualRepairSchema = z.infer<
  typeof v2SchemaIntegrityManualRepairSchemaSchema
>;

export const v2SchemaIntegrityRepairCapabilitySchema = z.object({
  available: z.boolean(),
  mode: z.enum(['auto', 'manual']),
  reason: v2SchemaIntegrityI18nMessageSchema.optional(),
  description: v2SchemaIntegrityI18nMessageSchema.optional(),
  manualRepairSchema: v2SchemaIntegrityManualRepairSchemaSchema.optional(),
});
export type IV2SchemaIntegrityRepairCapability = z.infer<
  typeof v2SchemaIntegrityRepairCapabilitySchema
>;

export const v2SchemaIntegrityFilterStatusSchema = z.enum(['success', 'error', 'warn', 'skipped']);

export type IV2SchemaIntegrityFilterStatus = z.infer<typeof v2SchemaIntegrityFilterStatusSchema>;

export const v2SchemaIntegrityStreamFilterRoSchema = z.object({
  statuses: z.array(v2SchemaIntegrityFilterStatusSchema).optional(),
});

export type IV2SchemaIntegrityStreamFilterRo = z.infer<
  typeof v2SchemaIntegrityStreamFilterRoSchema
>;

export const v2SchemaIntegrityCheckStatusSchema = z.enum([
  'success',
  'error',
  'warn',
  'pending',
  'running',
]);

export const v2SchemaIntegrityCheckResultSchema = z.object({
  id: z.string(),
  baseId: z.string().optional(),
  tableId: z.string().optional(),
  tableName: z.string().optional(),
  fieldId: z.string(),
  fieldName: z.string(),
  ruleId: z.string(),
  ruleDescription: z.string(),
  status: v2SchemaIntegrityCheckStatusSchema,
  message: z.string().optional(),
  details: v2SchemaIntegrityDetailsSchema.optional(),
  repair: v2SchemaIntegrityRepairCapabilitySchema.optional(),
  required: z.boolean(),
  timestamp: z.number(),
  dependencies: z.array(z.string()).optional(),
  depth: z.number().optional(),
});

export type IV2SchemaIntegrityCheckResult = z.infer<typeof v2SchemaIntegrityCheckResultSchema>;

export const v2SchemaIntegrityRepairStatusSchema = z.enum([
  'success',
  'error',
  'warn',
  'pending',
  'running',
  'skipped',
]);

export const v2SchemaIntegrityRepairOutcomeSchema = z.enum([
  'repaired',
  'unchanged',
  'manual',
  'skipped',
]);

export const v2SchemaIntegrityRepairResultSchema = z.object({
  id: z.string(),
  baseId: z.string().optional(),
  tableId: z.string().optional(),
  tableName: z.string().optional(),
  fieldId: z.string(),
  fieldName: z.string(),
  ruleId: z.string(),
  ruleDescription: z.string(),
  status: v2SchemaIntegrityRepairStatusSchema,
  outcome: v2SchemaIntegrityRepairOutcomeSchema.optional(),
  message: z.string().optional(),
  details: v2SchemaIntegrityDetailsSchema.optional(),
  repair: v2SchemaIntegrityRepairCapabilitySchema.optional(),
  required: z.boolean(),
  timestamp: z.number(),
  dependencies: z.array(z.string()).optional(),
  depth: z.number().optional(),
});

export type IV2SchemaIntegrityRepairResult = z.infer<typeof v2SchemaIntegrityRepairResultSchema>;

export const v2SchemaIntegrityRepairRoSchema = z
  .object({
    fieldId: z.string().optional(),
    ruleId: z.string().optional(),
    dryRun: z.boolean().optional(),
    statuses: z.array(v2SchemaIntegrityFilterStatusSchema).optional(),
    targetStatuses: z.array(z.enum(['warn', 'error'])).optional(),
    manualRepairValues: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.ruleId && !value.fieldId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fieldId'],
        message: 'fieldId is required when ruleId is provided',
      });
    }
  });

export type IV2SchemaIntegrityRepairRo = z.infer<typeof v2SchemaIntegrityRepairRoSchema>;

export const v2BaseSchemaIntegrityRepairRoSchema = z.object({
  dryRun: z.boolean().optional(),
  statuses: z.array(v2SchemaIntegrityFilterStatusSchema).optional(),
  targetStatuses: z.array(z.enum(['warn', 'error'])).optional(),
});

export type IV2BaseSchemaIntegrityRepairRo = z.infer<typeof v2BaseSchemaIntegrityRepairRoSchema>;

export const V2SchemaIntegrityDecisionRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_V2_SCHEMA_INTEGRITY_DECISION,
  description: 'Resolve whether the current base should use the v2 schema integrity flow',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the v2 schema integrity decision for the base',
      content: {
        'application/json': {
          schema: v2SchemaIntegrityDecisionVoSchema,
        },
      },
    },
  },
  tags: ['integrity'],
});

export const V2SchemaIntegrityCheckStreamRoute: RouteConfig = registerRoute({
  method: 'get',
  path: CHECK_V2_TABLE_SCHEMA_INTEGRITY_STREAM,
  description: 'Stream v2 schema integrity check results for a table',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: v2SchemaIntegrityStreamFilterRoSchema,
  },
  responses: {
    200: {
      description: 'SSE stream with schema integrity check results',
    },
  },
  tags: ['integrity'],
});

export const V2BaseSchemaIntegrityCheckStreamRoute: RouteConfig = registerRoute({
  method: 'get',
  path: CHECK_V2_BASE_SCHEMA_INTEGRITY_STREAM,
  description: 'Stream v2 schema integrity check results for a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: v2SchemaIntegrityStreamFilterRoSchema,
  },
  responses: {
    200: {
      description: 'SSE stream with base-level schema integrity check results',
    },
  },
  tags: ['integrity'],
});

export const V2SchemaIntegrityRepairStreamRoute: RouteConfig = registerRoute({
  method: 'post',
  path: REPAIR_V2_TABLE_SCHEMA_INTEGRITY_STREAM,
  description: 'Stream v2 schema integrity repair results for a table',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: v2SchemaIntegrityRepairRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with schema integrity repair results',
    },
  },
  tags: ['integrity'],
});

export const V2BaseSchemaIntegrityRepairStreamRoute: RouteConfig = registerRoute({
  method: 'post',
  path: REPAIR_V2_BASE_SCHEMA_INTEGRITY_STREAM,
  description: 'Stream v2 schema integrity repair results for a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: v2BaseSchemaIntegrityRepairRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SSE stream with base-level schema integrity repair results',
    },
  },
  tags: ['integrity'],
});

export const getV2SchemaIntegrityDecision = async (baseId: string) => {
  return axios.get<IV2SchemaIntegrityDecisionVo>(
    urlBuilder(GET_V2_SCHEMA_INTEGRITY_DECISION, {
      baseId,
    })
  );
};

const buildIntegrityStreamUrl = (
  path: string,
  pathParams: Record<string, string>,
  statuses?: IV2SchemaIntegrityFilterStatus[]
) => {
  const url = urlBuilder(path, pathParams);
  if (!statuses?.length) {
    return url;
  }

  const searchParams = new URLSearchParams();
  statuses.forEach((status) => searchParams.append('statuses', status));
  return `${url}?${searchParams.toString()}`;
};

export const streamV2TableSchemaIntegrityCheck = async (
  tableId: string,
  options?: {
    signal?: AbortSignal;
    onResult?: (result: IV2SchemaIntegrityCheckResult) => void;
    statuses?: IV2SchemaIntegrityFilterStatus[];
  }
): Promise<void> => {
  const baseURL = axios.defaults.baseURL || '/api';
  const url = `${baseURL}${buildIntegrityStreamUrl(
    CHECK_V2_TABLE_SCHEMA_INTEGRITY_STREAM,
    {
      tableId,
    },
    options?.statuses
  )}`;

  await streamSSE<IV2SchemaIntegrityCheckResult>(
    url,
    {
      method: 'GET',
      signal: options?.signal,
    },
    {
      onResult: options?.onResult,
      errorPrefix: schemaIntegrityStreamErrorPrefix,
    }
  );
};

export const streamV2BaseSchemaIntegrityCheck = async (
  baseId: string,
  options?: {
    signal?: AbortSignal;
    onResult?: (result: IV2SchemaIntegrityCheckResult) => void;
    statuses?: IV2SchemaIntegrityFilterStatus[];
  }
): Promise<void> => {
  const baseURL = axios.defaults.baseURL || '/api';
  const url = `${baseURL}${buildIntegrityStreamUrl(
    CHECK_V2_BASE_SCHEMA_INTEGRITY_STREAM,
    {
      baseId,
    },
    options?.statuses
  )}`;

  await streamSSE<IV2SchemaIntegrityCheckResult>(
    url,
    {
      method: 'GET',
      signal: options?.signal,
    },
    {
      onResult: options?.onResult,
      errorPrefix: schemaIntegrityStreamErrorPrefix,
    }
  );
};

export const streamV2TableSchemaIntegrityRepair = async (
  tableId: string,
  repairRo: IV2SchemaIntegrityRepairRo = {},
  options?: {
    signal?: AbortSignal;
    onResult?: (result: IV2SchemaIntegrityRepairResult) => void;
  }
): Promise<void> => {
  const baseURL = axios.defaults.baseURL || '/api';
  const url = `${baseURL}${urlBuilder(REPAIR_V2_TABLE_SCHEMA_INTEGRITY_STREAM, {
    tableId,
  })}`;

  await streamSSE<IV2SchemaIntegrityRepairResult>(
    url,
    {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(repairRo),
    },
    {
      onResult: options?.onResult,
      errorPrefix: schemaIntegrityStreamErrorPrefix,
    }
  );
};

export const streamV2BaseSchemaIntegrityRepair = async (
  baseId: string,
  repairRo: IV2BaseSchemaIntegrityRepairRo = {},
  options?: {
    signal?: AbortSignal;
    onResult?: (result: IV2SchemaIntegrityRepairResult) => void;
  }
): Promise<void> => {
  const baseURL = axios.defaults.baseURL || '/api';
  const url = `${baseURL}${urlBuilder(REPAIR_V2_BASE_SCHEMA_INTEGRITY_STREAM, {
    baseId,
  })}`;

  await streamSSE<IV2SchemaIntegrityRepairResult>(
    url,
    {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(repairRo),
    },
    {
      onResult: options?.onResult,
      errorPrefix: schemaIntegrityStreamErrorPrefix,
    }
  );
};
