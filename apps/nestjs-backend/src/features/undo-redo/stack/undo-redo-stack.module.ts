import { Module } from '@nestjs/common';
import { OperationListener } from './operation.listener';
import { UndoRedoStackService } from './undo-redo-stack.service';

@Module({
  providers: [UndoRedoStackService, OperationListener],
  exports: [UndoRedoStackService],
})
export class UndoRedoStackModule {}
