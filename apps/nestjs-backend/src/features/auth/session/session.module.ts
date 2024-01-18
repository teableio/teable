import type { NestModule, MiddlewareConsumer } from '@nestjs/common';
import { Module } from '@nestjs/common';
import passport from 'passport';
import { SessionHandleModule } from './session-handle.module';
import { SessionHandleService } from './session-handle.service';
import { SessionStoreService } from './session-store.service';

@Module({
  imports: [SessionHandleModule],
  providers: [SessionStoreService],
})
export class SessionModule implements NestModule {
  constructor(private readonly sessionHandleService: SessionHandleService) {}

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(this.sessionHandleService.sessionMiddleware, passport.initialize())
      .forRoutes('/api/*');
  }
}
