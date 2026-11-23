import { Module } from '@nestjs/common';
import { BaseModule } from '../base/base.module';
import { V2Module } from './v2.module';
import { V2Controller } from './v2.controller';
import { V2WorkflowModule } from './workflows/v2-workflow.module';

/** Public HTTP composition depends on native runtime and real host services in one direction. */
@Module({
  imports: [V2Module, BaseModule, V2WorkflowModule],
  controllers: [V2Controller],
})
export class V2PublicModule {}
