import Joi from 'joi';
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('test', 'development', 'production').default('development'),
  PORT: Joi.number().default(3000),

  NEXTJS_DIR: Joi.string(),

  SWAGGER_ENABLED: Joi.string().equal('true').optional(),

  // logger
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
});
