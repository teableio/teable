import { Command } from '@oclif/core';
import { BaseCommand } from './base-command';
import { isLocalhostConnection } from '../utils/localhost-check';

export abstract class MockSafeCommand<T extends typeof Command> extends BaseCommand<T> {
  protected validateConnection(): boolean {
    const connectionString = this.getConnectionString();
    if (!isLocalhostConnection(connectionString)) {
      this.printOutput(
        this.createErrorOutput(
          'security',
          {},
          {
            message: 'Remote database connections are not allowed for mock data generation.',
            code: 'REMOTE_CONNECTION_BLOCKED',
            details: {
              hint: 'This CLI only works with localhost PostgreSQL connections (127.0.0.1 or localhost) for safety.',
            },
          }
        )
      );
      return false;
    }
    return true;
  }
}
