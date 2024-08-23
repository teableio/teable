import { Module } from '@nestjs/common';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { RecordModule } from '../../record/record.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { UndoRedoOperationService } from './undo-redo-operation.service';
import { UndoRedoStackService } from './undo-redo-stack.service';

@Module({
  imports: [RecordModule, RecordOpenApiModule, ViewOpenApiModule],
  providers: [UndoRedoStackService, UndoRedoOperationService],
  exports: [UndoRedoStackService, UndoRedoOperationService],
})
export class UndoRedoStackModule {}
