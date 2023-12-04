import path from 'path';
import type { DynamicModule } from '@nestjs/common';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { authConfig } from './auth.config';
import { baseConfig } from './base.config';
import { bootstrapConfigs, nextJsConfig } from './bootstrap.config';
import { envValidationSchema } from './env.validation.schema';
import { loggerConfig } from './logger.config';
import { mailConfig } from './mail.config';

const configurations = [...bootstrapConfigs, loggerConfig, mailConfig, authConfig, baseConfig];

@Module({})
export class TeableConfigModule {
  static register(): DynamicModule {
    const logger = new Logger();

    return ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: configurations,
      envFilePath: ['.env.development.local', '.env.development', '.env'].map((str) => {
        const nextJsDir = nextJsConfig().dir;
        const envDir = nextJsDir ? path.join(process.cwd(), nextJsDir, str) : str;
        logger.log(`[Env File Path]: ${envDir}`);
        return envDir;
      }),
      validationSchema: envValidationSchema,
    });
  }
}
