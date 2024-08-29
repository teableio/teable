import { Module } from '@nestjs/common';
import { UndoRedoStackModule } from '../stack/undo-redo-stack.module';
import { UndoRedoController } from './undo-redo.controller';
import { UndoRedoService } from './undo-redo.service';

@Module({
  imports: [UndoRedoStackModule],
  controllers: [UndoRedoController],
  providers: [UndoRedoService],
})
export class UndoRedoModule {}
