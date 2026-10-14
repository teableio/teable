import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { DataApiMetricsMiddleware } from './data-api-metrics.middleware';
import { DataApiMetricsService } from './data-api-metrics.service';

@Module({ providers: [DataApiMetricsService] })
export class DataApiMetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Middleware observes guard/validation failures as well as handler failures.
    // Route classification is bounded inside the middleware; no controller imports.
    consumer.apply(DataApiMetricsMiddleware).forRoutes('{*splat}');
  }
}
