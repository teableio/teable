import { Module } from '@nestjs/common';
import { StorageModule } from '../../features/attachments/plugins/storage.module';
import { HeapProfilerService } from './heap-profiler.service';
import { MemoryMetricsService } from './memory-metrics.service';
import { ProfileUploader } from './profile-uploader';
import { ProfilerService } from './profiler.service';
@Module({
  imports: [StorageModule],
  providers: [ProfileUploader, ProfilerService, HeapProfilerService, MemoryMetricsService],
  exports: [ProfilerService],
})
export class ProfilerModule {}
