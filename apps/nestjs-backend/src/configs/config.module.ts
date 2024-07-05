/* eslint-disable @typescript-eslint/naming-convention */
import path from 'path';
import type { DynamicModule } from '@nestjs/common';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule as BaseConfigModule } from '@nestjs/config';
import { authConfig } from './auth.config';
import { baseConfig } from './base.config';
import { bootstrapConfigs, nextJsConfig } from './bootstrap.config';
import { cacheConfig } from './cache.config';
import { envValidationSchema } from './env.validation.schema';
import { loggerConfig } from './logger.config';
import { mailConfig } from './mail.config';
import { oauthConfig } from './oauth.config';
import { storageConfig } from './storage';
import { thresholdConfig } from './threshold.config';

const configurations = [
  ...bootstrapConfigs,
  loggerConfig,
  mailConfig,
  authConfig,
  baseConfig,
  storageConfig,
  thresholdConfig,
  cacheConfig,
  oauthConfig,
];

@Module({})
export class ConfigModule {
  static register(): DynamicModule {
    return BaseConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: configurations,
      envFilePath: ['.env.development.local', '.env.development', '.env'].map((str) => {
        const nextJsDir = nextJsConfig().dir;
        const envDir = nextJsDir ? path.join(process.cwd(), nextJsDir, str) : str;

        Logger.attachBuffer();
        Logger.log(`[Env File Path]: ${envDir}`);
        Logger.detachBuffer();
        return envDir;
      }),
      validationSchema: envValidationSchema,
    });
  }
}
