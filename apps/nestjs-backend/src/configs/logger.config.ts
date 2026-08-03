/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const loggerConfig = registerAs('logger', () => ({
  level: process.env.LOG_LEVEL ?? 'info',
  enableGlobalErrorLogging: process.env.ENABLE_GLOBAL_ERROR_LOGGING === 'true',
}));

export const LoggerConfig = () => Inject(loggerConfig.KEY);

export type ILoggerConfig = ConfigType<typeof loggerConfig>;
