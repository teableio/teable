import { Module } from '@nestjs/common';
import { ShareDbService } from './share-db.service';

@Module({
  providers: [ShareDbService],
  exports: [ShareDbService],
})
export class ShareDbModule {}
