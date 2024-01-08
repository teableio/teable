import { CacheModule as CacheManagerModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [CacheManagerModule.register()],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
