import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { resolveBoolean } from './v2-config-parsers';
import { V2DataQueryExplainController } from './v2-data-query-explain.controller';
import { V2DataQueryExplainService } from './v2-data-query-explain.service';
import { V2Module } from './v2.module';

@Module({
  imports: [V2Module],
  controllers: [V2DataQueryExplainController],
  providers: [V2DataQueryExplainService],
})
export class V2DataQueryExplainModule {
  /** Exactly the execute gate: explain is absent whenever execute is absent. */
  static register(): Promise<DynamicModule> {
    return ConditionalModule.registerWhen(
      V2DataQueryExplainModule,
      (env) =>
        resolveBoolean(env.V2_DATA_QUERY_ENABLED, false) ||
        resolveBoolean(env.V2_DATA_QUERY_EXECUTE_ENABLED, false),
      { timeout: process.env.NODE_ENV === 'test' ? 60_000 : 5000 }
    );
  }
}
