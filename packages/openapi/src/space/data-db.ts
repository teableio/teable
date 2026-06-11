import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SPACE_DATA_DB_PREFLIGHT = '/space/data-db/preflight';
export const GET_SPACE_DATA_DB = '/space/{spaceId}/data-db';
export const UPDATE_SPACE_DATA_DB = '/space/{spaceId}/data-db';
export const RETEST_SPACE_DATA_DB = '/space/{spaceId}/data-db/retest';
export const RETRY_SPACE_DATA_DB_MIGRATION = '/space/{spaceId}/data-db/retry';
const refreshedDataDbSummaryDescription = 'Returns the refreshed data database binding summary.';

export const dataDbModeSchema = z.enum(['default', 'byodb']);
export const dataDbTargetModeSchema = z.enum([
  'initialize-empty',
  'migrate-space',
  'adopt-existing',
]);
export const dataDbClassificationSchema = z.enum([
  'empty',
  'teable-managed-compatible',
  'teable-managed-incompatible',
  'non-empty-unknown',
]);
export const dataDbBindingStateSchema = z.enum([
  'ready',
  'validating',
  'initializing',
  'migrating',
  'error',
  'disabled',
]);

export const dataDbCapabilitiesSchema = z.object({
  createSchema: z.boolean(),
  createTable: z.boolean(),
  createFunction: z.boolean(),
  createTrigger: z.boolean(),
  createRole: z.boolean(),
  grantPrivileges: z.boolean(),
  inspectActivity: z.boolean(),
});
export const dataDbInternalSchemaSchema = z
  .string()
  .regex(/^[a-z_]\w*$/i)
  .optional();

export const dataDbPreflightErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  remediation: z.string().optional(),
});

export const dataDbPreflightRoSchema = z.object({
  url: z.string().min(1),
  targetMode: dataDbTargetModeSchema.optional().default('initialize-empty'),
  internalSchema: dataDbInternalSchemaSchema,
});

export type IDataDbPreflightRo = z.infer<typeof dataDbPreflightRoSchema>;

export const dataDbPreflightVoSchema = z.object({
  ok: z.boolean(),
  provider: z.literal('postgres'),
  maskedUrl: z.string().optional(),
  urlFingerprint: z.string().optional(),
  displayHost: z.string().optional(),
  displayDatabase: z.string().optional(),
  internalSchema: z.string().optional(),
  serverVersion: z.string().optional(),
  classification: dataDbClassificationSchema,
  availableDatabases: z.array(z.string()).optional(),
  requiresDatabaseSelection: z.boolean().optional(),
  capabilities: dataDbCapabilitiesSchema,
  errors: z.array(dataDbPreflightErrorSchema),
});

export type IDataDbPreflightVo = z.infer<typeof dataDbPreflightVoSchema>;

export const dataDbConnectionSummaryVoSchema = z.object({
  mode: dataDbModeSchema,
  state: dataDbBindingStateSchema,
  provider: z.literal('postgres').optional(),
  displayHost: z.string().optional(),
  displayDatabase: z.string().optional(),
  internalSchema: z.string().optional(),
  schemaVersion: z.string().nullable().optional(),
  lastValidatedAt: z.string().optional(),
  lastError: z.string().optional(),
  capabilities: dataDbCapabilitiesSchema.optional(),
});

export type IDataDbConnectionSummaryVo = z.infer<typeof dataDbConnectionSummaryVoSchema>;

export const SpaceDataDbPreflightRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SPACE_DATA_DB_PREFLIGHT,
  description: 'Validate a PostgreSQL data database before binding it to a space',
  request: {
    body: {
      content: {
        'application/json': {
          schema: dataDbPreflightRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns PostgreSQL data database validation details.',
      content: {
        'application/json': {
          schema: dataDbPreflightVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const GetSpaceDataDbRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SPACE_DATA_DB,
  description: 'Get the data database binding summary for a space',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the data database binding summary for a space.',
      content: {
        'application/json': {
          schema: dataDbConnectionSummaryVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const UpdateSpaceDataDbRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_SPACE_DATA_DB,
  description:
    'Update PostgreSQL credentials or connection parameters for the existing BYODB database',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: dataDbPreflightRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: refreshedDataDbSummaryDescription,
      content: {
        'application/json': {
          schema: dataDbConnectionSummaryVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const RetestSpaceDataDbRoute: RouteConfig = registerRoute({
  method: 'post',
  path: RETEST_SPACE_DATA_DB,
  description: 'Retest the PostgreSQL data database connection for a BYODB space',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: refreshedDataDbSummaryDescription,
      content: {
        'application/json': {
          schema: dataDbConnectionSummaryVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const RetrySpaceDataDbMigrationRoute: RouteConfig = registerRoute({
  method: 'post',
  path: RETRY_SPACE_DATA_DB_MIGRATION,
  description: 'Retry pending PostgreSQL data database migrations for a BYODB space',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: refreshedDataDbSummaryDescription,
      content: {
        'application/json': {
          schema: dataDbConnectionSummaryVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const preflightSpaceDataDb = async (data: IDataDbPreflightRo) => {
  return axios.post<IDataDbPreflightVo>(SPACE_DATA_DB_PREFLIGHT, data);
};

export const getSpaceDataDb = async (spaceId: string) => {
  return axios.get<IDataDbConnectionSummaryVo>(urlBuilder(GET_SPACE_DATA_DB, { spaceId }));
};

export const updateSpaceDataDb = async (spaceId: string, data: IDataDbPreflightRo) => {
  return axios.patch<IDataDbConnectionSummaryVo>(
    urlBuilder(UPDATE_SPACE_DATA_DB, { spaceId }),
    data
  );
};

export const retestSpaceDataDb = async (spaceId: string) => {
  return axios.post<IDataDbConnectionSummaryVo>(urlBuilder(RETEST_SPACE_DATA_DB, { spaceId }));
};

export const retrySpaceDataDbMigration = async (spaceId: string) => {
  return axios.post<IDataDbConnectionSummaryVo>(
    urlBuilder(RETRY_SPACE_DATA_DB_MIGRATION, { spaceId })
  );
};
