import { Module } from '@nestjs/common';
import { storageAdapterProvider } from './storage';

@Module({
  providers: [storageAdapterProvider],
  exports: [storageAdapterProvider],
})
export class StorageModule {}
