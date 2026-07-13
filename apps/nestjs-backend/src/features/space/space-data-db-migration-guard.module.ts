import { Module } from '@nestjs/common';
import { SpaceDataDbMigrationGuardService } from './space-data-db-migration-guard.service';

@Module({
  providers: [SpaceDataDbMigrationGuardService],
  exports: [SpaceDataDbMigrationGuardService],
})
export class SpaceDataDbMigrationGuardModule {}
