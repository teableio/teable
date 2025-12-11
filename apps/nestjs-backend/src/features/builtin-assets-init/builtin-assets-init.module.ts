import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageModule } from '../attachments/plugins/storage.module';
import { BuiltinAssetsInitService } from './builtin-assets-init.service';

@Module({
  imports: [StorageModule, ConfigModule],
  providers: [BuiltinAssetsInitService],
  exports: [BuiltinAssetsInitService],
})
export class BuiltinAssetsInitModule {}
