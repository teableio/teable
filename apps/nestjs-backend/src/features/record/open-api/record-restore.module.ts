import { Module } from '@nestjs/common';
import { RecordStorageModule } from '../../record-storage/record-storage.module';
import { V2Module } from '../../v2/v2.module';
import { RecordRestoreNativeService } from './record-restore-native.service';

@Module({
  imports: [RecordStorageModule, V2Module],
  providers: [RecordRestoreNativeService],
  exports: [RecordRestoreNativeService],
})
export class RecordRestoreModule {}
