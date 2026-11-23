import { Module } from '@nestjs/common';
import { FieldCacheService } from './field-cache.service';

@Module({
  providers: [FieldCacheService],
  exports: [FieldCacheService],
})
export class FieldCacheModule {}
