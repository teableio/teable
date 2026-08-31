/* eslint-disable @typescript-eslint/naming-convention */
import fs from 'fs';
import path from 'path';
import type { DynamicModule } from '@nestjs/common';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule as BaseConfigModule } from '@nestjs/config';
import { authConfig } from './auth.config';
import { baseConfig } from './base.config';
import { bootstrapConfigs, nextJsConfig } from './bootstrap.config';
import { cacheConfig } from './cache.config';
import { computedOutboxTriggerConfig } from './computed-outbox-trigger.config';
import { envValidationSchema } from './env.validation.schema';
import { loggerConfig } from './logger.config';
import { mailConfig } from './mail.config';
import { oauthConfig } from './oauth.config';
import { riskControlConfig } from './risk-control.config';
import { enforceSecretsPolicy } from './secrets/secrets-policy';
import { storageConfig } from './storage';
import { thresholdConfig } from './threshold.config';
import { trashConfig } from './trash.config';

const configurations = [
  ...bootstrapConfigs,
  loggerConfig,
  mailConfig,
  authConfig,
  baseConfig,
  storageConfig,
  thresholdConfig,
  cacheConfig,
  computedOutboxTriggerConfig,
  oauthConfig,
  trashConfig,
  riskControlConfig,
];

// The env files live in the nextjs-app package. NEXTJS_DIR is relative to the
// backend package dir, but the process may be started from the repo root (make,
// IDE run configs) — probe the known anchors instead of trusting cwd, since a
// silently unresolved path means the secrets policy would warn and fall back
// to the legacy source-code defaults instead of using your .env values.
const resolveEnvFileDir = (): string => {
  const nextJsDir = nextJsConfig().dir;
  const candidates = [
    path.join(process.cwd(), nextJsDir),
    path.join(process.cwd(), 'community/apps/nextjs-app'),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
};

@Module({})
export class ConfigModule {
  static register(): DynamicModule {
    const envDir = resolveEnvFileDir();
    const dynamicModule = BaseConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: configurations,
      envFilePath: ['.env.development.local', '.env.development', '.env'].map((str) => {
        const envFile = path.join(envDir, str);

        Logger.attachBuffer();
        Logger.log(`[Env File Path]: ${envFile}`);
        Logger.detachBuffer();
        return envFile;
      }),
      validationSchema: envValidationSchema,
    });
    // forRoot has synchronously merged the env files into process.env; enforce
    // the secrets policy now, before any config factory resolves a secret.
    enforceSecretsPolicy();
    return dynamicModule;
  }
}
