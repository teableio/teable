import { Module } from '@nestjs/common';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { LastVisitModule } from '../user/last-visit/last-visit.module';
import { PinController } from './pin.controller';
import { PinService } from './pin.service';

@Module({
  // CollaboratorModule: editions that resolve access-scoped pin types (enterprise chat pins)
  // extend PinService and need it injected.
  imports: [LastVisitModule, CollaboratorModule],
  providers: [PinService],
  controllers: [PinController],
})
export class PinModule {}
