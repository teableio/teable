import { Module } from '@nestjs/common';
import { SpaceCollaboratorController } from './space-collaborator.controller';
import { SpaceCollaboratorService } from './space-collaborator.service';

@Module({
  providers: [SpaceCollaboratorService],
  controllers: [SpaceCollaboratorController],
  exports: [SpaceCollaboratorService],
})
export class SpaceCollaboratorModule {}
