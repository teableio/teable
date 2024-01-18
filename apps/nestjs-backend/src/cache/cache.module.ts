import { CacheModule as CacheManagerModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import type { IBaseConfig } from '../configs/base.config';
import { baseConfig } from '../configs/base.config';
import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [
    CacheManagerModule.registerAsync({
      useFactory: async (baseConfig: IBaseConfig) => ({
        max: baseConfig.maxCacheSize,
      }),
      inject: [baseConfig.KEY],
    }),
  ],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
