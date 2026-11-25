import { Injectable } from '@nestjs/common';
import { DataDbMigrationService } from './data-db-migration.service';
import type { IDataDbPreflightClient } from './data-db-preflight.service';

@Injectable()
export class DataDbBaselineService {
  constructor(private readonly migrationService: DataDbMigrationService) {}

  async initialize(url: string, internalSchema?: string) {
    await this.migrationService.migrate(url, internalSchema);
    return this.migrationService.getLatestSchemaVersion();
  }

  validateSchemaVersion(client: IDataDbPreflightClient, internalSchema: string) {
    return this.migrationService.validateSchemaVersion(client, internalSchema);
  }
}
