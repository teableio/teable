import { Module } from '@nestjs/common';
import { BaseModule } from '../base/base.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { UserModule } from '../user/user.module';
import { ViewModule } from '../view/view.module';
import { TableTrashListener } from './listener/table-trash.listener';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({
  imports: [
    UserModule,
    BaseModule,
    TableOpenApiModule,
    FieldOpenApiModule,
    RecordOpenApiModule,
    ViewModule,
  ],
  controllers: [TrashController],
  providers: [TrashService, TableTrashListener],
  exports: [TrashService],
})
export class TrashModule {}
