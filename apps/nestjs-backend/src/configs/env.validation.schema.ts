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

  ASSET_PREFIX: Joi.string().uri().optional(),
  STORAGE_PREFIX: Joi.string().uri().optional(),

  PUBLIC_ORIGIN: Joi.string().uri(),

  BRAND_NAME: Joi.string().required(),

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
});
