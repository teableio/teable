import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base/base-command';

export default class UnderlyingTable extends BaseCommand<typeof UnderlyingTable> {
  static description = 'Get table metadata from underlying database';

  static examples = ['<%= config.bin %> underlying table --table-id tbl_xxx'];

  static flags = {
    ...BaseCommand.baseFlags,
    'table-id': Flags.string({
      required: true,
      description: 'Table ID to query',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(UnderlyingTable);
    this.flags = flags;

    const tableId = flags['table-id'];
    const input = { tableId };

    try {
      await this.initContainer();

      const { registerV2DebugData, v2DebugDataTokens } = await import('@teable/v2-debug-data');
      registerV2DebugData(this.container);

      const debugService = this.container.resolve(v2DebugDataTokens.debugDataService);
      const result = await debugService.getTableMeta(tableId);

      if (result.isErr()) {
        this.printOutput(this.createErrorOutput('underlying.table', input, result.error));
        this.exit(1);
      }

      if (this.isEmptyData(result.value)) {
        this.printOutput(
          this.createEmptyDataOutput(
            'underlying.table',
            input,
            `Table "${tableId}" not found. Check if the table ID is correct and exists in the database.`
          )
        );
        this.exit(1);
      }

      this.printOutput(this.createSuccessOutput('underlying.table', input, result.value));
    } catch (error) {
      this.printOutput(this.createErrorOutput('underlying.table', input, error));
      this.exit(1);
    }
  }
}
