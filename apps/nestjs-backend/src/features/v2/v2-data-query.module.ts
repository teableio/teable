import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { resolveBoolean } from './v2-config-parsers';
import { V2DataQueryController } from './v2-data-query.controller';
import { V2DataQueryService } from './v2-data-query.service';
import { V2Module } from './v2.module';

@Module({
  imports: [V2Module],
  controllers: [V2DataQueryController],
  providers: [V2DataQueryService],
})
export class V2DataQueryModule {
  static register(): Promise<DynamicModule> {
    return ConditionalModule.registerWhen(
      V2DataQueryModule,
      (env) =>
        resolveBoolean(env.V2_DATA_QUERY_ENABLED, false) ||
        resolveBoolean(env.V2_DATA_QUERY_EXECUTE_ENABLED, false),
      { timeout: process.env.NODE_ENV === 'test' ? 60_000 : 5000 }
    );
  }
}
