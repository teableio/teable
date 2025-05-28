import { Module } from '@nestjs/common';
import { BaseModule } from '../base/base.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [CollaboratorModule, BaseModule],
  providers: [DashboardService],
  controllers: [DashboardController],
  exports: [DashboardService],
})
export class DashboardModule {}
