import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base/base-command';

export default class UnderlyingTables extends BaseCommand<typeof UnderlyingTables> {
  static description = 'List all tables in a base from underlying database';

  static examples = ['<%= config.bin %> underlying tables --base-id bse_xxx'];

  static flags = {
    ...BaseCommand.baseFlags,
    'base-id': Flags.string({
      required: true,
      description: 'Base ID to query',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(UnderlyingTables);
    this.flags = flags;

    const baseId = flags['base-id'];
    const input = { baseId };

    try {
      await this.initContainer();

      const { registerV2DebugData, v2DebugDataTokens } = await import('@teable/v2-debug-data');
      registerV2DebugData(this.container);

      const debugService = this.container.resolve(v2DebugDataTokens.debugDataService);
      const result = await debugService.getTablesByBaseId(baseId);

      if (result.isErr()) {
        this.printOutput(this.createErrorOutput('underlying.tables', input, result.error));
        this.exit(1);
      }

      if (this.isEmptyData(result.value)) {
        this.printOutput(
          this.createEmptyDataOutput(
            'underlying.tables',
            input,
            `No tables found in base "${baseId}". Check if the base ID is correct or if the base has any tables.`
          )
        );
        this.exit(1);
      }

      this.printOutput(this.createSuccessOutput('underlying.tables', input, result.value));
    } catch (error) {
      this.printOutput(this.createErrorOutput('underlying.tables', input, error));
      this.exit(1);
    }
  }
}
