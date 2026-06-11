import { Module } from '@nestjs/common';
import { AttachmentsTableModule } from '../attachments/attachments-table.module';
import { BaseModule } from '../base/base.module';
import { CanaryModule } from '../canary/canary.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SpaceModule } from '../space/space.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { UserModule } from '../user/user.module';
import { V2Module } from '../v2/v2.module';
import { ViewModule } from '../view/view.module';
import { TableTrashListener } from './listener/table-trash.listener';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';
import { V2RecordTrashService } from './v2-record-trash.service';
import { V2TableTrashService } from './v2-table-trash.service';

@Module({
  imports: [
    AttachmentsTableModule,
    UserModule,
    SpaceModule,
    BaseModule,
    CanaryModule,
    TableOpenApiModule,
    FieldOpenApiModule,
    RecordOpenApiModule,
    RecordModule,
    V2Module,
    ViewModule,
  ],
  controllers: [TrashController],
  providers: [TrashService, TableTrashListener, V2RecordTrashService, V2TableTrashService],
  exports: [TrashService],
})
export class TrashModule {}
