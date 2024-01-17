import type { NestModule, MiddlewareConsumer } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { SessionHandleModule } from './session-handle.module';
import { SessionHandleService } from './session-handle.service';
import { SessionStoreService } from './session.service';

@Module({
  imports: [SessionHandleModule],
  providers: [SessionStoreService],
})
export class SessionModule implements NestModule {
  constructor(private readonly sessionHandleService: SessionHandleService) {}

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(this.sessionHandleService.sessionMiddleware).forRoutes('/api/*');
  }
}
