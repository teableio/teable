import { Module } from '@nestjs/common';
import { StorageModule } from '../../features/attachments/plugins/storage.module';
import { ProfilerService } from './profiler.service';
@Module({
  imports: [StorageModule],
  providers: [ProfilerService],
  exports: [ProfilerService],
})
export class ProfilerModule {}
