import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { AggregationOpenApiV2Service } from '../../aggregation/open-api/aggregation-open-api-v2.service';
import { BaseNodeModule } from '../../base-node/base-node.module';
import { ImportOpenApiV2Service } from '../../import/open-api/import-open-api-v2.service';
import { NotificationModule } from '../../notification/notification.module';
import { SpaceModule } from '../../space/space.module';
import { V2Module } from '../v2.module';
import { V2ImportWorkflowProcessor } from './v2-import-workflow.processor';
import { V2_IMPORT_WORKFLOW_QUEUE } from './v2-import-workflow.types';
import { V2WorkflowService } from './v2-workflow.service';

@Module({
  imports: [
    V2Module,
    BaseNodeModule,
    SpaceModule,
    NotificationModule,
    EventJobModule.registerQueue(V2_IMPORT_WORKFLOW_QUEUE),
  ],
  providers: [
    AggregationOpenApiV2Service,
    ImportOpenApiV2Service,
    V2WorkflowService,
    V2ImportWorkflowProcessor,
  ],
  exports: [V2WorkflowService],
})
export class V2WorkflowModule {}
