/* eslint-disable @typescript-eslint/naming-convention */
import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('test', 'development', 'production').default('development'),
  PORT: Joi.number().default(3000),

  NEXTJS_DIR: Joi.string(),

  SWAGGER_DISABLED: Joi.string().equal('true').optional(),

  // logger
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),

  // database_url
  PRISMA_DATABASE_URL: Joi.string().required(),

  // MySQL writer connection (optional, used when driver is MySQL)
  WRITER_DB_SCHEMA: Joi.string().optional(),
  WRITER_DB_USERNAME: Joi.string().optional(),
  WRITER_DB_PASSWORD: Joi.string().optional(),
  WRITER_DB_HOSTNAME: Joi.string().optional(),
  WRITER_DB_PORT: Joi.number().optional(),
  WRITER_DB_POOL_MIN: Joi.number().optional(),
  WRITER_DB_POOL_MAX: Joi.number().optional(),
  WRITER_DB_POOL_ACQUIRE: Joi.number().optional(),
  WRITER_DB_POOL_IDLE: Joi.number().optional(),

  // MySQL reader connection (optional, for read/write splitting)
  READER_DB_SCHEMA: Joi.string().optional(),
  READER_DB_USERNAME: Joi.string().optional(),
  READER_DB_PASSWORD: Joi.string().optional(),
  READER_DB_HOSTNAME: Joi.string().optional(),
  READER_DB_PORT: Joi.number().optional(),
  READER_DB_POOL_MIN: Joi.number().optional(),
  READER_DB_POOL_MAX: Joi.number().optional(),
  READER_DB_POOL_ACQUIRE: Joi.number().optional(),
  READER_DB_POOL_IDLE: Joi.number().optional(),

  STORAGE_PREFIX: Joi.string().uri().optional(),

  PUBLIC_ORIGIN: Joi.string().uri().required(),

  // cache
  BACKEND_CACHE_PROVIDER: Joi.string().valid('memory', 'sqlite', 'redis').default('sqlite'),
  // cache-sqlite
  BACKEND_CACHE_SQLITE_URI: Joi.when('BACKEND_CACHE_PROVIDER', {
    is: 'sqlite',
    then: Joi.string()
      .pattern(/^sqlite:\/\//)
      .message('Cache `sqlite` the URI must start with the protocol `sqlite://`'),
  }),
  // cache-redis
  BACKEND_CACHE_REDIS_URI: Joi.when('BACKEND_CACHE_PROVIDER', {
    is: 'redis',
    then: Joi.string()
      .pattern(/^(redis:\/\/|rediss:\/\/)/)
      .message('Cache `redis` the URI must start with the protocol `redis://` or `rediss://`'),
  }),
  // github auth
  BACKEND_GITHUB_CLIENT_ID: Joi.when('SOCIAL_AUTH_PROVIDERS', {
    is: Joi.string()
      .regex(/(^|,)(github)(,|$)/)
      .required(),
    then: Joi.string().required().messages({
      'any.required':
        'The `BACKEND_GITHUB_CLIENT_ID` is required when `SOCIAL_AUTH_PROVIDERS` includes `github`',
    }),
  }),
  BACKEND_GITHUB_CLIENT_SECRET: Joi.when('SOCIAL_AUTH_PROVIDERS', {
    is: Joi.string()
      .regex(/(^|,)(github)(,|$)/)
      .required(),
    then: Joi.string().required().messages({
      'any.required':
        'The `BACKEND_GITHUB_CLIENT_SECRET` is required when `SOCIAL_AUTH_PROVIDERS` includes `github`',
    }),
  }),

  PASSWORD_LOGIN_DISABLED: Joi.string().equal('true').optional(),
});
