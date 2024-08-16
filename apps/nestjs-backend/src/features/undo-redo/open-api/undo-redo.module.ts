import { Module } from '@nestjs/common';
import { UndoRedoStackModule } from '../stack/undo-redo-stack.module';
import { UndoRedoService } from './undo-redo.service';

@Module({
  imports: [UndoRedoStackModule],
  providers: [UndoRedoService],
  exports: [UndoRedoService],
})
export class UndoRedoModule {}
