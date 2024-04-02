import { Module } from '@nestjs/common';
import { SessionHandleService } from './session-handle.service';
import { SessionStoreService } from './session-store.service';

@Module({
  providers: [SessionStoreService, SessionHandleService],
  exports: [SessionHandleService],
})
export class SessionHandleModule {}
