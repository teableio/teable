import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { GithubModule } from './github/github.module';
import { GoogleModule } from './google/google.module';

@Module({
  imports: [
    ConditionalModule.registerWhen(GithubModule, (env) => {
      return Boolean(env.SOCIAL_AUTH_PROVIDERS?.split(',')?.includes('github'));
    }),
    ConditionalModule.registerWhen(GoogleModule, (env) => {
      return Boolean(env.SOCIAL_AUTH_PROVIDERS?.split(',')?.includes('google'));
    }),
  ],
})
export class SocialModule {}
