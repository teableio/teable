/* eslint-disable @typescript-eslint/naming-convention */
import { executablePhase1RemediationKindValues } from '@teable/v2-table-query-ops';
import Joi from 'joi';

import { resolveBoolean } from '../features/v2/v2-config-parsers';
import {
  DEFAULT_BASE_PENDING_CAPACITY_QUERY_LIMIT,
  DEFAULT_BASE_PENDING_CAPACITY_THRESHOLD,
  DEFAULT_COMPUTED_OUTBOX_WORKER_CONCURRENCY,
} from './computed-outbox-trigger.config';

/** `envName` becomes required once `SOCIAL_AUTH_PROVIDERS` lists `provider`. */
const requiredForSocialProvider = (
  provider: string,
  envName: string,
  schema: Joi.StringSchema = Joi.string()
) =>
  Joi.when('SOCIAL_AUTH_PROVIDERS', {
    is: Joi.string()
      .regex(new RegExp(`(^|,)(${provider})(,|$)`))
      .required(),
    then: schema.required().messages({
      'any.required': `The \`${envName}\` is required when \`SOCIAL_AUTH_PROVIDERS\` includes \`${provider}\``,
    }),
  });

// `<Services ID>:<Team ID>:<Key ID>`: a reverse-DNS Services ID and two 10-character Apple ids.
const appleClientSchema = Joi.string()
  .pattern(/^[^:\s]+:[A-Z0-9]{10}:[A-Z0-9]{10}$/)
  .messages({
    'string.pattern.base':
      'The `BACKEND_APPLE_CLIENT` must be `<Services ID>:<Team ID>:<Key ID>`, e.g. `ai.example.signin:ABCDE12345:FGHIJ67890`',
  });

// Feature flags below are read straight from `ConfigService`, so they must accept exactly the
// spellings the runtime parsers accept, and stay optional: an absent key means "use the code
// default", which differs per key. Joi schemas are immutable, so the keys share one instance.
const envBooleanSchema = Joi.alternatives().try(
  Joi.boolean(),
  Joi.string()
    .trim()
    .lowercase()
    .pattern(/^(1|0|true|false|yes|no|on|off)$/)
    .custom((value) => resolveBoolean(value))
);

// `auto` enables the search access path; every other accepted spelling resolves to `off`.
const envSearchRuntimeModeSchema = Joi.alternatives().try(
  Joi.boolean(),
  Joi.string()
    .trim()
    .lowercase()
    .valid('auto', 'off', 'on', 'enabled', 'disabled', 'true', 'false', 'yes', 'no', '1', '0')
);

const envIntegerSchema = Joi.number().integer().min(0);

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('test', 'development', 'production').default('development'),
  PORT: Joi.number().default(3000),

  NEXTJS_DIR: Joi.string(),

  SWAGGER_DISABLED: Joi.string().equal('true').optional(),

  // logger
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),

  // database_url
  PRISMA_DATABASE_URL: Joi.string(),
  PRISMA_META_DATABASE_URL: Joi.string(),
  DATABASE_URL: Joi.string(),
  DATABASE_POOL_MAX: Joi.number().integer().positive().optional(),
  BYODB_DATA_DB_POOL_MAX: Joi.number().integer().positive().optional(),
  // BYODB data budget: pods × databases × (data pool + 2 auxiliary) ≤ max_connections × 0.8.
  // All three inputs are required; a partial topology keeps the legacy data pool of 5. The formula
  // can raise the data pool up to 20, and BYODB_DATA_DB_POOL_MAX stays an explicit ceiling.
  // The coordination pool uses the meta connection string and is budgeted against the meta server.
  BYODB_DATA_DB_PG_MAX_CONNECTIONS: Joi.number().integer().positive().optional(),
  BYODB_DATA_DB_DATABASES_PER_SERVER: Joi.number().integer().positive().optional(),
  BYODB_APP_NODES: Joi.number().integer().positive().optional(),
  BYODB_DATA_DB_QUEUE_LIMIT: Joi.number().integer().min(0).optional(),
  BYODB_DATA_DB_QUEUE_TIMEOUT_MS: Joi.number().integer().min(0).optional(),
  // Coordination pools are per data-database container: containers × maxConnections.
  V2_SCHEMA_COORDINATION_MAX_CONNECTIONS: Joi.number().integer().positive().optional(),
  V2_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(0).optional(),
  V2_COMPUTED_UPDATE_MODE: Joi.string().valid('sync').optional(),

  STORAGE_PREFIX: Joi.string().uri().optional(),

  PUBLIC_ORIGIN: Joi.string().uri().required(),

  // secrets — shape only; production requirements and migration teaching are
  // enforced by enforceSecretsPolicy (configs/secrets/secrets-policy.ts)
  SECRET_KEY: Joi.string().optional(),
  BACKEND_JWT_SECRET: Joi.string().optional(),
  BACKEND_JWT_SECRET_OLD: Joi.string().optional(),
  BACKEND_SESSION_SECRET: Joi.string().optional(),
  BACKEND_SESSION_SECRET_OLD: Joi.string().optional(),
  BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: Joi.string().optional(),
  BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: Joi.string().optional(),
  BACKEND_DATA_DB_URL_ENCRYPTION_KEY: Joi.string().optional(),
  BACKEND_DATA_DB_URL_ENCRYPTION_IV: Joi.string().optional(),
  BACKEND_MAIL_ENCRYPTION_KEY: Joi.string().optional(),
  BACKEND_MAIL_ENCRYPTION_IV: Joi.string().optional(),
  BACKEND_STORAGE_ENCRYPTION_KEY: Joi.string().optional(),
  BACKEND_STORAGE_ENCRYPTION_IV: Joi.string().optional(),
  BACKEND_ENV_VARIABLE_SECRET: Joi.string().optional(),

  // Express `trust proxy`: 'true' | 'false' | hop count | IP/CIDR/preset list.
  // Unset = trust private-network proxies (see parseTrustProxy in bootstrap.config).
  BACKEND_TRUST_PROXY: Joi.string().optional(),

  // cache, queues and realtime pub/sub all run on Redis
  BACKEND_CACHE_REDIS_URI: Joi.string()
    .pattern(/^(redis:\/\/|rediss:\/\/)/)
    .message('Cache `redis` the URI must start with the protocol `redis://` or `rediss://`')
    .required(),

  V2_DATA_QUERY_ENABLED: Joi.alternatives()
    .try(
      Joi.boolean(),
      Joi.string()
        .trim()
        .lowercase()
        .pattern(/^(1|0|true|false|yes|no|on|off)$/)
        .custom((value) => resolveBoolean(value))
    )
    .default(false),

  // Runtime availability for already-adopted Apps when authoring/adoption is disabled.
  V2_DATA_QUERY_EXECUTE_ENABLED: Joi.alternatives()
    .try(
      Joi.boolean(),
      Joi.string()
        .trim()
        .lowercase()
        .pattern(/^(1|0|true|false|yes|no|on|off)$/)
        .custom((value) => resolveBoolean(value))
    )
    .default(false),

  // Table Query Ops (search access path and index advisor) is configured per deployment and read
  // when a v2 container is created, so an invalid value used to fall back to the code default
  // silently. Values are validated below; absence stays meaningful and gets no default.
  V2_TABLE_QUERY_OPS_ENABLED: envBooleanSchema,
  // Runs search access path maintenance tasks (table-write and reclaim triggers) without the
  // observation, analyzer or auto-accept stack.
  V2_TABLE_QUERY_OPS_SEARCH_MAINTENANCE_ENABLED: envBooleanSchema,
  V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME: envSearchRuntimeModeSchema,
  V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME: envSearchRuntimeModeSchema,
  V2_TABLE_QUERY_OPS_TASK_WORKER_ENABLED: envBooleanSchema,
  V2_TABLE_QUERY_OPS_TASK_WORKER_INTERVAL_MS: envIntegerSchema,
  V2_TABLE_QUERY_OPS_ANALYZER_ENABLED: envBooleanSchema,
  V2_TABLE_QUERY_OPS_ANALYZER_INTERVAL_MS: envIntegerSchema,
  V2_TABLE_QUERY_OPS_ANALYZER_LOOKBACK_MS: envIntegerSchema,
  V2_TABLE_QUERY_OPS_ANALYZER_BATCH_SIZE: envIntegerSchema,
  V2_TABLE_QUERY_OPS_AUTO_ACCEPT: Joi.string()
    .trim()
    .lowercase()
    .valid('off', 'shadow', 'auto')
    .messages({
      'any.only': 'The `V2_TABLE_QUERY_OPS_AUTO_ACCEPT` must be one of `off`, `shadow` or `auto`',
    }),
  V2_TABLE_QUERY_OPS_ALLOW_MANUAL_INDEX_EXECUTION: envBooleanSchema,
  V2_TABLE_QUERY_OPS_ALLOWED_TASK_KINDS: Joi.string()
    .trim()
    .custom((value: string, helpers) => {
      const invalid = value
        .split(',')
        .map((kind) => kind.trim())
        .filter(
          (kind) =>
            kind.length > 0 &&
            !executablePhase1RemediationKindValues.includes(
              kind as (typeof executablePhase1RemediationKindValues)[number]
            )
        );
      return invalid.length === 0 ? value : helpers.error('any.invalid');
    })
    .messages({
      'any.invalid': `The \`V2_TABLE_QUERY_OPS_ALLOWED_TASK_KINDS\` accepts only: ${executablePhase1RemediationKindValues.join(', ')}`,
    }),
  V2_TABLE_QUERY_OPS_ENSURE_SCHEMA: envBooleanSchema,
  V2_TABLE_QUERY_OPS_WORKER_ID: Joi.string().trim(),
  V2_TABLE_QUERY_OPS_CAPTURE_SQL_SAMPLE: envBooleanSchema,
  V2_TABLE_QUERY_OPS_SQL_SAMPLE_MAX_LENGTH: envIntegerSchema,
  V2_TABLE_QUERY_OPS_SQL_DIAGNOSTICS_MAX_PER_OBSERVATION: envIntegerSchema,
  // 0 means "no timeout" and resolves to the code default, so the floor is 0 here.
  V2_TABLE_QUERY_OPS_POOL_CONNECTION_TIMEOUT_MS: envIntegerSchema,
  V2_TABLE_QUERY_OPS_LOCK_TIMEOUT_MS: envIntegerSchema,
  V2_TABLE_QUERY_OPS_STATEMENT_TIMEOUT_MS: envIntegerSchema,
  V2_TABLE_QUERY_OPS_FLUSH_INTERVAL_MS: envIntegerSchema,
  V2_TABLE_QUERY_OPS_MAX_PENDING_KEYS: envIntegerSchema,
  V2_TABLE_QUERY_OPS_BATCH_SIZE: envIntegerSchema,
  V2_TABLE_QUERY_OPS_MIN_WINDOW_REQUESTS: envIntegerSchema,
  V2_TABLE_QUERY_OPS_RETENTION_DAYS: envIntegerSchema,

  V2_COMPUTED_OUTBOX_TRIGGER_PRODUCER_ENABLED: Joi.boolean().optional(),
  V2_COMPUTED_OUTBOX_TRIGGER_CONSUMER_ENABLED: Joi.boolean().optional(),
  V2_COMPUTED_OUTBOX_TRIGGER_CONCURRENCY: Joi.number()
    .integer()
    .positive()
    .default(DEFAULT_COMPUTED_OUTBOX_WORKER_CONCURRENCY),
  V2_COMPUTED_OUTBOX_TRIGGER_PUBLISH_TIMEOUT_MS: Joi.number().integer().positive().default(1000),
  V2_COMPUTED_OUTBOX_MONITOR_CONCURRENCY: Joi.number().integer().positive().default(4),
  V2_COMPUTED_OUTBOX_MONITOR_INTERVAL_MS: Joi.number().integer().positive().default(30000),
  V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_BASE: Joi.number().integer().positive().default(2),
  V2_COMPUTED_OUTBOX_MAX_CONCURRENT_PER_SEED_TABLE: Joi.number().integer().positive().default(1),
  V2_COMPUTED_OUTBOX_TASK_STATEMENT_TIMEOUT_MS: Joi.number().integer().min(0).default(60000),
  V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_THRESHOLD: Joi.number()
    .integer()
    .positive()
    .default(DEFAULT_BASE_PENDING_CAPACITY_THRESHOLD),
  V2_COMPUTED_OUTBOX_BASE_PENDING_CAPACITY_QUERY_LIMIT: Joi.number()
    .integer()
    .positive()
    .default(DEFAULT_BASE_PENDING_CAPACITY_QUERY_LIMIT),
  V2_COMPUTED_OUTBOX_LOCK_STARVATION_ESCALATION_AGE_MS: Joi.number()
    .integer()
    .min(0)
    .default(30000),
  V2_COMPUTED_OUTBOX_LOCK_STARVATION_ESCALATION_WAIT_MS: Joi.number()
    .integer()
    .min(0)
    .default(5000),
  V2_COMPUTED_INLINE_STATEMENT_TIMEOUT_MS: Joi.number().integer().min(0).default(60000),
  V2_COMPUTED_OUTBOX_FIELD_BACKFILL_BATCH_SIZE: Joi.number().integer().positive().default(500),
  V2_COMPUTED_OUTBOX_CONTINUATION_RELAY_CLAIM_ENABLED: Joi.boolean().optional(),
  // Computed stage budget overrides (0 disables that dimension; all 0 = no staging)

  // per-space scheduling concurrency limits (default and ceiling per resource)
  SPACE_AI_FIELD_GENERATION_DEFAULT_LIMIT: Joi.number().integer().positive().optional(),
  SPACE_WORKFLOW_RUN_DEFAULT_LIMIT: Joi.number().integer().positive().optional(),
  SPACE_ROUTINE_RUN_DEFAULT_LIMIT: Joi.number().integer().positive().optional(),
  // github auth
  BACKEND_GITHUB_CLIENT_ID: requiredForSocialProvider('github', 'BACKEND_GITHUB_CLIENT_ID'),
  BACKEND_GITHUB_CLIENT_SECRET: requiredForSocialProvider('github', 'BACKEND_GITHUB_CLIENT_SECRET'),
  // apple auth (Sign in with Apple, web flow)
  BACKEND_APPLE_CLIENT: requiredForSocialProvider(
    'apple',
    'BACKEND_APPLE_CLIENT',
    appleClientSchema
  ),
  BACKEND_APPLE_PRIVATE_KEY: requiredForSocialProvider('apple', 'BACKEND_APPLE_PRIVATE_KEY'),

  PASSWORD_LOGIN_DISABLED: Joi.string().equal('true').optional(),
  SIGNIN_ACCOUNT_LOCKOUT_ENABLED: Joi.boolean().optional(),
  SIGNIN_MAX_LOGIN_ATTEMPTS: Joi.number().integer().positive().optional(),
  SIGNIN_ACCOUNT_LOCKOUT_MINUTES: Joi.number().integer().positive().optional(),
})
  .custom((env: Record<string, unknown>, helpers) => {
    if (
      env.V2_COMPUTED_OUTBOX_TRIGGER_PRODUCER_ENABLED === false &&
      env.V2_COMPUTED_OUTBOX_TRIGGER_CONSUMER_ENABLED === false
    ) {
      return helpers.message({
        custom: 'BullMQ computed outbox requires a producer or consumer role',
      });
    }
    return env;
  })
  .or('PRISMA_META_DATABASE_URL', 'PRISMA_DATABASE_URL', 'DATABASE_URL')
  .messages({
    'object.missing':
      'One of `PRISMA_META_DATABASE_URL`, legacy `PRISMA_DATABASE_URL`, or `DATABASE_URL` is required',
  });
