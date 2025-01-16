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

  STORAGE_PREFIX: Joi.string().uri().optional(),

  PUBLIC_ORIGIN: Joi.string().uri().required(),

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

  SIGNIN_MAX_LOGIN_ATTEMPTS: Joi.when('SIGNIN_ACCOUNT_LOCKOUT_MINUTES', {
    is: Joi.number().required(),
    then: Joi.number().required().messages({
      'any.required':
        'The `SIGNIN_MAX_LOGIN_ATTEMPTS` is required when `SIGNIN_ACCOUNT_LOCKOUT_MINUTES` is set',
    }),
  }),
  SIGNIN_ACCOUNT_LOCKOUT_MINUTES: Joi.when('SIGNIN_MAX_LOGIN_ATTEMPTS', {
    is: Joi.number().required(),
    then: Joi.number().required().messages({
      'any.required':
        'The `SIGNIN_ACCOUNT_LOCKOUT_MINUTES` is required when `SIGNIN_MAX_LOGIN_ATTEMPTS` is set',
    }),
  }),
});
