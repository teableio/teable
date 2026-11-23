import { Global, Module } from '@nestjs/common';
import { FieldCacheModule } from '../field-cache/field-cache.module';
import { DataLoaderService } from './data-loader.service';
import { FieldLoaderService } from './resource/field-loader.service';
import { TableLoaderService } from './resource/table-loader.service';
import { ViewLoaderService } from './resource/view-loader.service';

@Global()
@Module({
  imports: [FieldCacheModule],
  providers: [DataLoaderService, TableLoaderService, FieldLoaderService, ViewLoaderService],
  exports: [DataLoaderService],
})
export class DataLoaderModule {}
