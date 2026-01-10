import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base/base-command';

export default class UnderlyingField extends BaseCommand<typeof UnderlyingField> {
  static description =
    'Get field metadata from underlying database (includes parsed options/meta JSON)';

  static examples = ['<%= config.bin %> underlying field --field-id fld_xxx'];

  static flags = {
    ...BaseCommand.baseFlags,
    'field-id': Flags.string({
      required: true,
      description: 'Field ID to query',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(UnderlyingField);
    this.flags = flags;

    const fieldId = flags['field-id'];
    const input = { fieldId };

    try {
      await this.initContainer();

      const { registerV2DebugData, v2DebugDataTokens } = await import('@teable/v2-debug-data');
      registerV2DebugData(this.container);

      const debugService = this.container.resolve(v2DebugDataTokens.debugDataService);
      const result = await debugService.getField(fieldId);

      if (result.isErr()) {
        this.printOutput(this.createErrorOutput('underlying.field', input, result.error));
        this.exit(1);
      }

      if (this.isEmptyData(result.value)) {
        this.printOutput(
          this.createEmptyDataOutput(
            'underlying.field',
            input,
            `Field "${fieldId}" not found. Check if the field ID is correct and exists in the database.`
          )
        );
        this.exit(1);
      }

      this.printOutput(this.createSuccessOutput('underlying.field', input, result.value));
    } catch (error) {
      this.printOutput(this.createErrorOutput('underlying.field', input, error));
      this.exit(1);
    }
  }
}
