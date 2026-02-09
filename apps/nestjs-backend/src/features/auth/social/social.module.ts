/* eslint-disable @typescript-eslint/naming-convention */
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { GithubModule } from './github/github.module';
import { GoogleModule } from './google/google.module';
import { OIDCModule } from './oidc/oidc.module';

const CONDITIONAL_MODULE_TIMEOUT = process.env.CI ? 30000 : 5000;

@Module({
  imports: [
    ConditionalModule.registerWhen(
      GithubModule,
      (env) => {
        return Boolean(env.SOCIAL_AUTH_PROVIDERS?.split(',')?.includes('github'));
      },
      { timeout: CONDITIONAL_MODULE_TIMEOUT }
    ),
    ConditionalModule.registerWhen(
      GoogleModule,
      (env) => {
        return Boolean(env.SOCIAL_AUTH_PROVIDERS?.split(',')?.includes('google'));
      },
      { timeout: CONDITIONAL_MODULE_TIMEOUT }
    ),
    ConditionalModule.registerWhen(
      OIDCModule,
      (env) => {
        return Boolean(env.SOCIAL_AUTH_PROVIDERS?.split(',')?.includes('oidc'));
      },
      { timeout: CONDITIONAL_MODULE_TIMEOUT }
    ),
  ],
})
export class SocialModule {}
