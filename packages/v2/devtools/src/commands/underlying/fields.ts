import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base/base-command';

export default class UnderlyingFields extends BaseCommand<typeof UnderlyingFields> {
  static description = 'List all fields in a table from underlying database';

  static examples = ['<%= config.bin %> underlying fields --table-id tbl_xxx'];

  static flags = {
    ...BaseCommand.baseFlags,
    'table-id': Flags.string({
      required: true,
      description: 'Table ID to query',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(UnderlyingFields);
    this.flags = flags;

    const tableId = flags['table-id'];
    const input = { tableId };

    try {
      await this.initContainer();

      const { registerV2DebugData, v2DebugDataTokens } = await import('@teable/v2-debug-data');
      registerV2DebugData(this.container);

      const debugService = this.container.resolve(v2DebugDataTokens.debugDataService);
      const result = await debugService.getFieldsByTableId(tableId);

      if (result.isErr()) {
        this.printOutput(this.createErrorOutput('underlying.fields', input, result.error));
        this.exit(1);
      }

      if (this.isEmptyData(result.value)) {
        this.printOutput(
          this.createEmptyDataOutput(
            'underlying.fields',
            input,
            `No fields found for table "${tableId}". Check if the table ID is correct or if the table has any fields.`
          )
        );
        this.exit(1);
      }

      this.printOutput(this.createSuccessOutput('underlying.fields', input, result.value));
    } catch (error) {
      this.printOutput(this.createErrorOutput('underlying.fields', input, error));
      this.exit(1);
    }
  }
}
