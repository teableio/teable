import { Module } from '@nestjs/common';
import { CanaryModule } from '../../canary/canary.module';
import { RecordRemovalColdCoreModule } from '../../record-removal-cold/record-removal-cold.module';
import { V2Module } from '../../v2/v2.module';
import { UndoRedoStackModule } from '../stack/undo-redo-stack.module';
import { UndoRedoController } from './undo-redo.controller';
import { UndoRedoService } from './undo-redo.service';

@Module({
  imports: [CanaryModule, RecordRemovalColdCoreModule, UndoRedoStackModule, V2Module],
  controllers: [UndoRedoController],
  providers: [UndoRedoService],
})
export class UndoRedoModule {}
