import { Module } from '@nestjs/common';
import { SpaceCollaboratorModule } from '../collaborator/space-collaborator/space-collaborator.module';
import { SpaceController } from './space.controller';
import { SpaceService } from './space.service';

@Module({
  controllers: [SpaceController],
  providers: [SpaceService],
  exports: [SpaceService],
  imports: [SpaceCollaboratorModule],
})
export class SpaceModule {}
