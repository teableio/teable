import { Injectable } from '@nestjs/common';
import { DataDbMigrationService } from './data-db-migration.service';

@Injectable()
export class DataDbBaselineService {
  constructor(private readonly migrationService: DataDbMigrationService) {}

  async initialize(url: string, internalSchema?: string) {
    await this.migrationService.migrate(url, internalSchema);
    return this.migrationService.getLatestSchemaVersion();
  }

  getLatestSchemaVersion() {
    return this.migrationService.getLatestSchemaVersion();
  }
}
