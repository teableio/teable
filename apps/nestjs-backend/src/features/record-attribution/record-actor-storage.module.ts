import { Global, Module } from '@nestjs/common';
import { RecordActorResolverService } from './record-actor-resolver.service';
import { RecordActorStorageService } from './record-actor-storage.service';

@Global()
@Module({
  providers: [RecordActorStorageService, RecordActorResolverService],
  exports: [RecordActorStorageService, RecordActorResolverService],
})
export class RecordActorStorageModule {}
