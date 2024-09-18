import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module, RequestMethod } from '@nestjs/common';
import { PluginProxyMiddleware } from './plugin-proxy.middleware';
@Module({
  providers: [],
  imports: [],
})
export class PluginProxyModule implements NestModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configure(consumer: MiddlewareConsumer): any {
    consumer.apply(PluginProxyMiddleware).forRoutes({
      method: RequestMethod.ALL,
      path: 'plugin/?*',
    });
  }
}
