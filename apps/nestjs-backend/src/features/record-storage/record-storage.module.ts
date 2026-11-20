import { Module } from '@nestjs/common';
import { RecordStoragePresenceService } from './record-storage-presence.service';

@Module({
  providers: [RecordStoragePresenceService],
  exports: [RecordStoragePresenceService],
})
export class RecordStorageModule {}
