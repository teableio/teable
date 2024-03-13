import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { GithubModule } from './github/github.module';

@Module({
  imports: [
    ConditionalModule.registerWhen(GithubModule, (env) => {
      return Boolean(env.SOCIAL_AUTH_PROVIDERS?.includes('github'));
    }),
  ],
})
export class SocialModule {}
