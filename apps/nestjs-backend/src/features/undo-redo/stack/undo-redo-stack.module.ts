import { Module, forwardRef } from '@nestjs/common';
import { FieldOpenApiModule } from '../../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { RecordModule } from '../../record/record.module';
import { TableDomainQueryModule } from '../../table-domain';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { UndoRedoOperationService } from './undo-redo-operation.service';
import { UndoRedoStackService } from './undo-redo-stack.service';

@Module({
  imports: [
    RecordModule,
    forwardRef(() => RecordOpenApiModule),
    ViewModule,
    ViewOpenApiModule,
    forwardRef(() => FieldOpenApiModule),
    TableDomainQueryModule,
  ],
  providers: [UndoRedoStackService, UndoRedoOperationService],
  exports: [UndoRedoStackService, UndoRedoOperationService],
})
export class UndoRedoStackModule {}
