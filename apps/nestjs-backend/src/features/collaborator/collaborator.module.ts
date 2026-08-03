import { Module } from '@nestjs/common';
import { CollaboratorController } from './collaborator.controller';
import { CollaboratorService } from './collaborator.service';

@Module({
  providers: [CollaboratorService],
  controllers: [CollaboratorController],
  exports: [CollaboratorService],
})
export class CollaboratorModule {}
