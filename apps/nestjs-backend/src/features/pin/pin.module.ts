import { Module } from '@nestjs/common';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { LastVisitModule } from '../user/last-visit/last-visit.module';
import { PinController } from './pin.controller';
import { PinService } from './pin.service';

@Module({
  // CollaboratorModule: every pin branch is scoped to the caller's bases and spaces.
  imports: [LastVisitModule, CollaboratorModule],
  providers: [PinService],
  controllers: [PinController],
})
export class PinModule {}
